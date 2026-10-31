#!/usr/bin/env node
/**
 * 一键初始化：克隆仓库后跑这个脚本，后端就能直接起来。
 *
 * 做的事：
 *   1. 检查 Node 版本（>= 18）
 *   2. server/.env 不存在就从 .env.example 复制
 *   3. 安装后端依赖
 *   4. 生成 Prisma Client
 *   5. 检查演示数据库 dev.db 是否存在（不存在则建库 + 播种子）
 *
 * 用法：node scripts/init.mjs
 */
import { existsSync, copyFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const prismaDir = join(serverDir, 'prisma')

function step(msg) {
  console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`)
}
function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
}
function fail(msg) {
  console.error(`  \x1b[31m✗ ${msg}\x1b[0m`)
  process.exit(1)
}
function run(cmd, cwd = serverDir) {
  execSync(cmd, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

// 1. Node 版本
step('检查运行环境')
const major = Number(process.versions.node.split('.')[0])
if (major < 18) fail(`Node 版本过低（当前 ${process.versions.node}），需要 >= 18`)
ok(`Node ${process.versions.node}`)

// 2. 环境变量
step('准备环境变量')
const envFile = join(serverDir, '.env')
const envExample = join(serverDir, '.env.example')
if (existsSync(envFile)) {
  ok('.env 已存在，跳过')
} else if (existsSync(envExample)) {
  copyFileSync(envExample, envFile)
  ok('已从 .env.example 复制出 .env')
} else {
  fail('缺少 .env.example，请从仓库重新下载')
}

// 3. 依赖
step('安装后端依赖')
run('npm install')

// 4. Prisma Client
step('生成 Prisma Client')
run('npx prisma generate')
ok('Prisma Client 就绪')

// 5. 数据库
step('准备数据库')
const dbFile = join(prismaDir, 'dev.db')
if (existsSync(dbFile)) {
  ok('演示数据库 dev.db 已存在，直接可用')
} else {
  console.log('  未找到 dev.db，执行建库 + 写入种子数据…')
  run('npx prisma db push')
  ok('数据库已创建')
}

console.log(`
\x1b[32m✓ 初始化完成\x1b[0m

下一步：
  启动后端：  cd server && npm run start:dev
  启动前端：  cd web && npm install && npm run dev
  浏览器打开：\x1b[36mhttp://localhost:5173\x1b[0m
  演示账号：  admin / 123456
`)
