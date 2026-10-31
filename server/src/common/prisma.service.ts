import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/**
 * SQLite 加固要点：
 * 1. WAL 模式：读不阻塞写、写不阻塞读，多店同时开单时不会被整体读写锁卡住
 * 2. busy_timeout：写锁被占用时自动等待而不是立刻抛 SQLITE_BUSY
 * 3. synchronous=NORMAL：WAL 下兼顾性能与崩溃安全（掉电最多丢最后一条已提交事务）
 *
 * MySQL 模式下这些 PRAGMA 会自动跳过。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)
  private isSqlite = false

  async onModuleInit() {
    await this.$connect()

    // 当前数据源是否为 SQLite
    this.isSqlite = String(process.env.DB_PROVIDER || 'sqlite').toLowerCase() === 'sqlite'
    if (!this.isSqlite) {
      this.logger.log('数据源：MySQL')
      return
    }

    const pragmas: Array<[string, string]> = [
      ['journal_mode', 'WAL'],
      ['busy_timeout', '8000'],
      ['synchronous', 'NORMAL'],
      ['foreign_keys', 'ON']
    ]
    const failed: string[] = []
    for (const [k, v] of pragmas) {
      try {
        // journal_mode / busy_timeout 这类 PRAGMA 赋值后会返回结果行，
        // 必须用 queryRaw（executeRaw 会因「返回结果」直接报错，导致 WAL 其实没生效）
        await this.$queryRawUnsafe(`PRAGMA ${k} = ${v}`)
      } catch (e) {
        // 少数不返回结果的 PRAGMA 在 queryRaw 下会失败，退回 executeRaw 再试一次
        try {
          await this.$executeRawUnsafe(`PRAGMA ${k} = ${v}`)
        } catch (e2) {
          failed.push(k)
          this.logger.warn(`PRAGMA ${k} 设置失败：${e2?.message || e2}`)
        }
      }
    }
    this.logger.log(
      failed.length
        ? `数据源：SQLite（PRAGMA 部分未生效：${failed.join('、')}）`
        : '数据源：SQLite（已启用 WAL / busy_timeout=8000ms）'
    )
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }

  /**
   * 写冲突自动重试：SQLite 单写者锁下并发入库/记账可能偶发 SQLITE_BUSY，
   * 这里做指数退避重试，避免直接把错误抛给用户。
   */
  async retryOnBusy<T>(fn: () => Promise<T>, max = 5): Promise<T> {
    let lastErr: any
    for (let i = 0; i < max; i++) {
      try {
        return await fn()
      } catch (e: any) {
        lastErr = e
        const msg = String(e?.message || '')
        const busy =
          // SQLite：单写者锁
          msg.includes('SQLITE_BUSY') ||
          msg.includes('SQLITE_LOCKED') ||
          msg.includes('database is locked') ||
          msg.includes('database table is locked') ||
          // MySQL：死锁(1213) / 锁等待超时(1205)
          msg.includes('Deadlock found') ||
          msg.includes('Lock wait timeout') ||
          msg.includes('1213') ||
          msg.includes('1205') ||
          // Prisma 侧：写冲突、事务 API 超时、查询超时
          e?.code === 'P2034' ||
          e?.code === 'P2028' ||
          e?.code === 'P1008' ||
          e?.code === 'P2024'
        if (!busy) throw e
        await new Promise((r) => setTimeout(r, 60 * Math.pow(2, i) + Math.random() * 40))
      }
    }
    throw lastErr
  }
}
