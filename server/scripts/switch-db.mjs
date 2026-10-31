#!/usr/bin/env node
/**
 * 数据源一键切换：SQLite <-> MySQL
 *
 * 用法：
 *   node scripts/switch-db.mjs sqlite           # 切回 SQLite（本机默认）
 *   node scripts/switch-db.mjs mysql            # 切到 MySQL
 *   DB_PROVIDER=mysql node scripts/switch-db.mjs
 *   node scripts/switch-db.mjs mysql --no-generate   # 只改配置，不重新生成 Prisma Client
 *
 * 做了三件事：
 *   1. 重写 prisma/schema.prisma 的 datasource.provider（Prisma 不允许 provider 用 env()，只能改字面量）
 *   2. 同步 .env：DATABASE_URL / DB_PROVIDER
 *   3. 按需跑 prisma generate（MySQL 下顺手补 @db.Text，避免备注类字段被截断）
 *
 * 数据迁移不在脚本范围内（SQLite 与 MySQL 的表结构互不通用），
 * 切到 MySQL 后需要执行 npm run db:push 让 Prisma 建表 + 跑种子数据。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const schemaPath = path.join(root, 'prisma', 'schema.prisma')
const envPath = path.join(root, '.env')

/** MySQL 下需要放宽到 TEXT 的字段：SQLite 无所谓，MySQL 默认 String 是 VARCHAR(191)，长备注会被截断报错 */
const TEXT_FIELDS = {
  Store: ['address'],
  Product: ['image', 'remark'],
  Order: ['remark'],
  SalesReturn: ['remark'],
}

const args = process.argv.slice(2)
const want = (args.find((a) => !a.startsWith('--')) || process.env.DB_PROVIDER || 'sqlite').toLowerCase()
if (!['sqlite', 'mysql'].includes(want)) {
  console.error('用法：node scripts/switch-db.mjs <sqlite|mysql>')
  process.exit(1)
}
const runGenerate = !args.includes('--no-generate')

/** 读 .env，保留其他配置，只更新指定键 */
function upsertEnv(content, key, value) {
  const line = `${key}="${value}"`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`
}

/** MySQL 连接串：优先用 MYSQL_URL 整体写法，否则用分项拼，缺省值见下 */
function mysqlUrl() {
  const env = process.env
  if (env.MYSQL_URL) return env.MYSQL_URL
  const user = env.MYSQL_USER || 'root'
  const pass = env.MYSQL_PASSWORD || '123456'
  const host = env.MYSQL_HOST || 'localhost'
  const port = env.MYSQL_PORT || '3306'
  const db = env.MYSQL_DATABASE || 'clothing_store'
  return `mysql://${user}:${pass}@${host}:${port}/${db}`
}

// 1. 改 schema.prisma
let schema = fs.readFileSync(schemaPath, 'utf8')
// 先把上一轮可能写进去的 @db.Text 清掉，保证幂等（SQLite 不认这个属性，留着 generate 会报错）
schema = schema.replace(/(\s+)@db\.Text/g, '')
schema = schema.replace(/provider\s*=\s*"[a-zA-Z]+"/, `provider = "${want}"`)

if (want === 'mysql') {
  // 只在对应 model 块内加 @db.Text，按行处理避免跨模型误伤
  const lines = schema.split('\n')
  let model = null
  schema = lines
    .map((line) => {
      const open = /^model (\w+) \{/.exec(line)
      if (open) {
        model = open[1]
        return line
      }
      if (/^\}/.test(line)) model = null
      const field = /^(\s+)(\w+)(\s+String\??)\s*$/.exec(line)
      if (model && field && (TEXT_FIELDS[model] || []).includes(field[2])) {
        return `${line.trimEnd()} @db.Text`
      }
      return line
    })
    .join('\n')
}
fs.writeFileSync(schemaPath, schema)

// 2. 改 .env
const envText = fs.readFileSync(envPath, 'utf8')
let next = upsertEnv(envText, 'DB_PROVIDER', want)
next = upsertEnv(next, 'DATABASE_URL', want === 'mysql' ? mysqlUrl() : 'file:./dev.db')
fs.writeFileSync(envPath, next)

console.log(`已切换数据源 -> ${want}`)
console.log(`  DATABASE_URL = ${next.match(/^DATABASE_URL="(.*)"$/m)[1]}`)
console.log(`  schema.prisma provider = ${want}${want === 'mysql' ? '（已为备注/图片字段加 @db.Text）' : ''}`)

// 3. 重新生成 Prisma Client（生成失败不影响脚本退出，提示用户手动跑）
if (runGenerate) {
  console.log('正在重新生成 Prisma Client ...')
  const res = spawnSync('npx', ['prisma', 'generate'], { cwd: root, stdio: 'inherit' })
  if (res.status !== 0) {
    console.warn('prisma generate 未成功，请手动执行：npx prisma generate')
  }
}

if (want === 'mysql') {
  console.log(`
下一步（MySQL）：
  1. 确认 MySQL 里已建库：CREATE DATABASE clothing_store CHARACTER SET utf8mb4;
  2. 按需设置 MYSQL_URL（或 MYSQL_USER/PASSWORD/HOST/PORT/DATABASE）后重跑本脚本
  3. npm run db:push      # 建表（首次会自动写入种子数据）
  4. npm run build && npm run start
切回 SQLite：node scripts/switch-db.mjs sqlite（dev.db 不会被删，数据还在）`)
}
