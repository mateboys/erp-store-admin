import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaService } from '../common/prisma.service';
import { Guard, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/user.decorator';
import { PERM } from '../common/permissions';
import { round2, percent } from '../common/money';

/** 低库存阈值：<= 5 件算告警 */
const LOW_STOCK_THRESHOLD = 5;

@Controller('dashboard')
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  private storeWhere(user: AuthUser, storeId: string): any {
    if (user.role !== 'ADMIN') return { storeId: user.storeId ?? -1 };
    if (!storeId || storeId === 'all' || storeId === 'undefined') return {};
    return { storeId: +storeId };
  }

  private ratio(cur: number, prev: number) {
    if (!prev) return cur > 0 ? 100 : 0;
    return percent(cur, prev) as number;
  }

  /** 门店总览：今日营业额 / 毛利 + 环比 */
  @Guard(PERM.DASHBOARD)
  @Get('overview')
  async overview(@Query('storeId') storeId: string, @CurrentUser() user: AuthUser) {
    const base = this.storeWhere(user, storeId);
    const now = dayjs();
    const todayStart = now.startOf('day');
    const yesterdayStart = todayStart.subtract(1, 'day');
    const monthStart = now.startOf('month');
    // 上月同期：上月1号 -> 上月(今天日期)当天结束（超出月末按月末）
    const lastMonthStart = monthStart.subtract(1, 'month');
    const daysInLastMonth = lastMonthStart.daysInMonth();
    const lastMonthEnd = lastMonthStart
      .add(Math.min(now.date(), daysInLastMonth) - 1, 'day')
      .endOf('day');

    const agg = async (from: dayjs.Dayjs, to: dayjs.Dayjs) => {
      const rows = await this.prisma.order.findMany({
        where: { ...base, createdAt: { gte: from.toDate(), lte: to.toDate() } },
        select: { totalAmount: true, totalCost: true, totalProfit: true, itemCount: true, type: true },
      });
      return rows.reduce(
        (acc, r) => {
          acc.sales += r.totalAmount;
          acc.cost += r.totalCost;
          acc.profit += r.totalProfit;
          // 件数按净额算（退货冲减单是负数），但订单数只数真实成交单，
          // 否则一张「未关联退货」的冲减单会被当成多卖了一单
          acc.items += r.itemCount;
          if (r.type !== 'RETURN') acc.orders += 1;
          return acc;
        },
        { sales: 0, cost: 0, profit: 0, items: 0, orders: 0 },
      );
    };

    const [today, yesterday, month, lastMonth] = await Promise.all([
      agg(todayStart, now),
      agg(yesterdayStart, todayStart.subtract(1, 'millisecond')),
      agg(monthStart, now),
      agg(lastMonthStart, lastMonthEnd),
    ]);

    // 退货单独统计：销售额里其实已经扣过了，这里只是把「退了多少」显性展示出来
    const retAgg = async (from: dayjs.Dayjs, to: dayjs.Dayjs) => {
      const rows = await this.prisma.salesReturn.findMany({
        where: { ...base, createdAt: { gte: from.toDate(), lte: to.toDate() } },
        select: { refundAmount: true, refundProfit: true, quantity: true },
      });
      return rows.reduce(
        (acc, r) => {
          acc.amount += r.refundAmount;
          acc.profit += r.refundProfit;
          acc.items += r.quantity;
          acc.count += 1;
          return acc;
        },
        { amount: 0, profit: 0, items: 0, count: 0 },
      );
    };

    const [todayRet, monthRet] = await Promise.all([
      retAgg(todayStart, now),
      retAgg(monthStart, now),
    ]);

    // 热销商品 TOP 8（本月）
    const monthOrders = await this.prisma.order.findMany({
      where: { ...base, createdAt: { gte: monthStart.toDate() } },
      select: { id: true },
    });
    const orderIds = monthOrders.map((o) => o.id);
    let topProducts: any[] = [];
    if (orderIds.length) {
      // 不能直接 sum(quantity)：退货过的商品要把退回的件数扣掉（关联退货只加 returnedQty，
      // 明细 quantity 不变），所以这里按「有效件数」自己聚合
      const itemRows = await this.prisma.orderItem.findMany({
        where: { orderId: { in: orderIds } },
        select: {
          productId: true,
          quantity: true,
          returnedQty: true,
          unitPrice: true,
          unitCost: true,
        },
      });
      const aggMap = new Map<number, { quantity: number; amount: number; profit: number }>();
      for (const it of itemRows) {
        const eff = it.quantity - (it.returnedQty || 0);
        const cur = aggMap.get(it.productId) || { quantity: 0, amount: 0, profit: 0 };
        cur.quantity += eff;
        cur.amount += it.unitPrice * eff;
        cur.profit += (it.unitPrice - it.unitCost) * eff;
        aggMap.set(it.productId, cur);
      }
      const grouped = Array.from(aggMap.entries())
        .filter(([, v]) => v.quantity > 0)
        .map(([productId, v]) => ({ productId, ...v }));
      const products = await this.prisma.product.findMany({
        where: { id: { in: grouped.map((g) => g.productId) } },
      });
      const pmap = new Map(products.map((p) => [p.id, p]));
      topProducts = grouped
        .map((g: any) => ({
          sku: pmap.get(g.productId)?.sku,
          name: pmap.get(g.productId)?.name,
          image: pmap.get(g.productId)?.image,
          quantity: g.quantity || 0,
          amount: round2(g.amount || 0),
          profit: user.permissions.includes(PERM.COST) ? round2(g.profit || 0) : null,
        }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 8);
    }

    const canSeeCost = user.permissions.includes(PERM.COST);
    return {
      canSeeCost,
      today: {
        sales: round2(today.sales),
        profit: canSeeCost ? round2(today.profit) : null,
        orders: today.orders,
        items: today.items,
        returnAmount: round2(todayRet.amount),
        returnItems: todayRet.items,
        returnCount: todayRet.count,
      },
      yesterday: {
        sales: round2(yesterday.sales),
        profit: canSeeCost ? round2(yesterday.profit) : null,
      },
      month: {
        sales: round2(month.sales),
        profit: canSeeCost ? round2(month.profit) : null,
        orders: month.orders,
        items: month.items,
        returnAmount: round2(monthRet.amount),
        returnItems: monthRet.items,
        returnCount: monthRet.count,
      },
      lastMonth: {
        sales: round2(lastMonth.sales),
        profit: canSeeCost ? round2(lastMonth.profit) : null,
      },
      mom: {
        sales: this.ratio(month.sales, lastMonth.sales),
        profit: canSeeCost ? this.ratio(month.profit, lastMonth.profit) : null,
      },
      dod: {
        sales: this.ratio(today.sales, yesterday.sales),
        profit: canSeeCost ? this.ratio(today.profit, yesterday.profit) : null,
      },
      topProducts,
    };
  }

  /**
   * 趋势图
   * range: day14 | month | monthPick | month12 | custom
   */
  @Guard(PERM.DASHBOARD)
  @Get('trend')
  async trend(
    @Query('storeId') storeId: string,
    @Query('range') range: string = 'day14',
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    const base = this.storeWhere(user, storeId);
    const canSeeCost = user.permissions.includes(PERM.COST);

    let start: dayjs.Dayjs;
    let end: dayjs.Dayjs;
    let unit: 'day' | 'month' = 'day';

    const now = dayjs();
    if (range === 'day14') {
      start = now.subtract(13, 'day').startOf('day');
      end = now.endOf('day');
    } else if (range === 'month') {
      // 「当前月」与「选择月份」已合并：不带 month 就是当前月，
      // 一律按整月（1 号 ~ 月末）出数，不按当前月已过天数截断
      const m = month ? dayjs(month) : now;
      start = m.startOf('month');
      end = m.endOf('month');
    } else if (range === 'monthPick') {
      const m = month ? dayjs(month) : now;
      start = m.startOf('month');
      end = m.endOf('month');
    } else if (range === 'month12') {
      start = now.subtract(11, 'month').startOf('month');
      end = now.endOf('month');
      unit = 'month';
    } else if (range === 'custom') {
      if (!from || !to) throw new BadRequestException('请选择起止日期');
      start = dayjs(from).startOf('day');
      end = dayjs(to).endOf('day');
      if (end.diff(start, 'day') > 92) unit = 'month';
    } else {
      start = now.subtract(13, 'day').startOf('day');
      end = now.endOf('day');
    }

    const orders = await this.prisma.order.findMany({
      where: { ...base, createdAt: { gte: start.toDate(), lte: end.toDate() } },
      select: {
        totalAmount: true,
        totalCost: true,
        totalProfit: true,
        itemCount: true,
        createdAt: true,
        type: true,
      },
    });
    // 退货按「退货发生日」统计，单独一条线，不参与销售额（销售额里已经扣过了）
    const returnRows = await this.prisma.salesReturn.findMany({
      where: { ...base, createdAt: { gte: start.toDate(), lte: end.toDate() } },
      select: { refundAmount: true, quantity: true, createdAt: true },
    });

    const buckets: Array<{
      label: string;
      sales: number;
      profit: number;
      orders: number;
      items: number;
      returns: number;
      returnItems: number;
    }> = [];
    const indexMap = new Map<string, number>();

    const push = (key: string, label: string) => {
      if (!indexMap.has(key)) {
        indexMap.set(key, buckets.length);
        buckets.push({ label, sales: 0, profit: 0, orders: 0, items: 0, returns: 0, returnItems: 0 });
      }
      return indexMap.get(key)!;
    };

    if (unit === 'day') {
      let cursor = start.clone();
      while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
        push(cursor.format('YYYY-MM-DD'), cursor.format('MM-DD'));
        cursor = cursor.add(1, 'day');
      }
      for (const o of orders) {
        const k = dayjs(o.createdAt).format('YYYY-MM-DD');
        const idx = indexMap.get(k);
        if (idx == null) continue;
        buckets[idx].sales += o.totalAmount;
        buckets[idx].profit += o.totalProfit;
        if (o.type !== 'RETURN') buckets[idx].orders += 1;
        buckets[idx].items += o.itemCount;
      }
      for (const r of returnRows) {
        const k = dayjs(r.createdAt).format('YYYY-MM-DD');
        const idx = indexMap.get(k);
        if (idx == null) continue;
        buckets[idx].returns += r.refundAmount;
        buckets[idx].returnItems += r.quantity;
      }
    } else {
      let cursor = start.clone().startOf('month');
      while (cursor.isBefore(end)) {
        push(cursor.format('YYYY-MM'), cursor.format('YYYY-MM'));
        cursor = cursor.add(1, 'month');
      }
      for (const o of orders) {
        const k = dayjs(o.createdAt).format('YYYY-MM');
        const idx = indexMap.get(k);
        if (idx == null) continue;
        buckets[idx].sales += o.totalAmount;
        buckets[idx].profit += o.totalProfit;
        if (o.type !== 'RETURN') buckets[idx].orders += 1;
        buckets[idx].items += o.itemCount;
      }
      for (const r of returnRows) {
        const k = dayjs(r.createdAt).format('YYYY-MM');
        const idx = indexMap.get(k);
        if (idx == null) continue;
        buckets[idx].returns += r.refundAmount;
        buckets[idx].returnItems += r.quantity;
      }
    }

    const totalSales = buckets.reduce((s, b) => s + b.sales, 0);
    const totalProfit = buckets.reduce((s, b) => s + b.profit, 0);
    const totalReturns = buckets.reduce((s, b) => s + b.returns, 0);

    return {
      unit,
      range,
      labels: buckets.map((b) => b.label),
      sales: buckets.map((b) => round2(b.sales)),
      profit: canSeeCost ? buckets.map((b) => round2(b.profit)) : [],
      orders: buckets.map((b) => b.orders),
      items: buckets.map((b) => b.items),
      returns: buckets.map((b) => round2(b.returns)),
      returnItems: buckets.map((b) => b.returnItems),
      totalSales: round2(totalSales),
      totalReturns: round2(totalReturns),
      totalProfit: canSeeCost ? round2(totalProfit) : null,
      canSeeCost,
    };
  }

  /** 库存告警：列出库存 <= 5 件的商品（0 件也算，按剩余量升序） */
  @Guard(PERM.DASHBOARD)
  @Get('low-stock')
  async lowStock(
    @Query('storeId') storeId: string,
    @Query('limit') limit: string,
    @CurrentUser() user: AuthUser,
  ) {
    const base = this.storeWhere(user, storeId);
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const where: any = { ...base, quantity: { lte: LOW_STOCK_THRESHOLD } };
    const [rows, total] = await Promise.all([
      this.prisma.stock.findMany({
        where,
        include: { product: true, store: true },
        orderBy: [{ quantity: 'asc' }, { updatedAt: 'desc' }],
        take,
      }),
      this.prisma.stock.count({ where }),
    ]);
    return {
      threshold: LOW_STOCK_THRESHOLD,
      total,
      rows: rows.map((s: any) => ({
        productId: s.productId,
        sku: s.product?.sku,
        name: s.product?.name,
        image: s.product?.image,
        quantity: s.quantity,
        salePrice: s.salePrice,
        storeId: s.storeId,
        storeName: s.store?.name || null,
      })),
    };
  }

  /**
   * 个人总览：只统计「我」经手的数据。
   *
   * 与经营总览的区别：经营总览是门店/公司口径（管理员可切公司总览看全盘），
   * 这里固定按 operatorId = 当前登录用户过滤，看的是本人的业绩与操作量。
   * 门店范围仍然生效（管理员在「公司总览」时，本人的单跨店也算）。
   */
  @Guard(PERM.DASHBOARD)
  @Get('personal')
  async personal(@Query('storeId') storeId: string, @CurrentUser() user: AuthUser) {
    const base = { ...this.storeWhere(user, storeId), operatorId: user.id };
    const now = dayjs();
    const todayStart = now.startOf('day');
    const yesterdayStart = todayStart.subtract(1, 'day');
    const monthStart = now.startOf('month');
    const lastMonthStart = monthStart.subtract(1, 'month');
    const daysInLastMonth = lastMonthStart.daysInMonth();
    const lastMonthEnd = lastMonthStart
      .add(Math.min(now.date(), daysInLastMonth) - 1, 'day')
      .endOf('day');

    const agg = async (from: dayjs.Dayjs, to: dayjs.Dayjs) => {
      const rows = await this.prisma.order.findMany({
        where: { ...base, createdAt: { gte: from.toDate(), lte: to.toDate() } },
        select: { totalAmount: true, totalCost: true, totalProfit: true, itemCount: true, type: true },
      });
      return rows.reduce(
        (acc, r) => {
          acc.sales += r.totalAmount;
          acc.cost += r.totalCost;
          acc.profit += r.totalProfit;
          acc.items += r.itemCount;
          if (r.type !== 'RETURN') acc.orders += 1;
          return acc;
        },
        { sales: 0, cost: 0, profit: 0, items: 0, orders: 0 },
      );
    };

    const [today, yesterday, month, lastMonth] = await Promise.all([
      agg(todayStart, now),
      agg(yesterdayStart, todayStart.subtract(1, 'millisecond')),
      agg(monthStart, now),
      agg(lastMonthStart, lastMonthEnd),
    ]);

    // 退货：按「我处理的」统计（退货单也有操作人）
    const retAgg = async (from: dayjs.Dayjs, to: dayjs.Dayjs) => {
      const rows = await this.prisma.salesReturn.findMany({
        where: { ...base, createdAt: { gte: from.toDate(), lte: to.toDate() } },
        select: { refundAmount: true, refundProfit: true, quantity: true },
      });
      return rows.reduce(
        (acc, r) => {
          acc.amount += r.refundAmount;
          acc.profit += r.refundProfit;
          acc.items += r.quantity;
          acc.count += 1;
          return acc;
        },
        { amount: 0, profit: 0, items: 0, count: 0 },
      );
    };
    const [todayRet, monthRet] = await Promise.all([
      retAgg(todayStart, now),
      retAgg(monthStart, now),
    ]);

    // 本人的热销商品 TOP 8（本月，按有效件数聚合）
    const monthOrders = await this.prisma.order.findMany({
      where: { ...base, createdAt: { gte: monthStart.toDate() } },
      select: { id: true },
    });
    let topProducts: any[] = [];
    if (monthOrders.length) {
      const itemRows = await this.prisma.orderItem.findMany({
        where: { orderId: { in: monthOrders.map((o) => o.id) } },
        select: { productId: true, quantity: true, returnedQty: true, unitPrice: true, unitCost: true },
      });
      const aggMap = new Map<number, { quantity: number; amount: number; profit: number }>();
      for (const it of itemRows) {
        const eff = it.quantity - (it.returnedQty || 0);
        const cur = aggMap.get(it.productId) || { quantity: 0, amount: 0, profit: 0 };
        cur.quantity += eff;
        cur.amount += it.unitPrice * eff;
        cur.profit += (it.unitPrice - it.unitCost) * eff;
        aggMap.set(it.productId, cur);
      }
      const grouped = Array.from(aggMap.entries())
        .filter(([, v]) => v.quantity > 0)
        .map(([productId, v]) => ({ productId, ...v }));
      const products = await this.prisma.product.findMany({
        where: { id: { in: grouped.map((g) => g.productId) } },
      });
      const pmap = new Map(products.map((p) => [p.id, p]));
      topProducts = grouped
        .map((g: any) => ({
          sku: pmap.get(g.productId)?.sku,
          name: pmap.get(g.productId)?.name,
          image: pmap.get(g.productId)?.image,
          quantity: g.quantity || 0,
          amount: round2(g.amount || 0),
          profit: user.permissions.includes(PERM.COST) ? round2(g.profit || 0) : null,
        }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 8);
    }

    // 本人的出入库作业量（本月）：入库/出库件数与笔数
    const myBatches = await this.prisma.stockBatch.findMany({
      where: { ...base, createdAt: { gte: monthStart.toDate() } },
      select: { direction: true, quantity: true, type: true },
    });
    const moveAgg = myBatches.reduce(
      (acc, b) => {
        const key = b.direction === 'OUT' ? 'out' : 'in';
        acc[key].count += 1;
        acc[key].items += b.quantity;
        if (b.direction === 'OUT') {
          if (b.type === 'LOSS') acc.loss.count += 1;
          else if (b.type === 'SUPPLIER') acc.supplier.count += 1;
          else if (b.type === 'TRANSFER') acc.transfer.count += 1;
        }
        return acc;
      },
      {
        in: { count: 0, items: 0 },
        out: { count: 0, items: 0 },
        loss: { count: 0 },
        supplier: { count: 0 },
        transfer: { count: 0 },
      },
    );

    const canSeeCost = user.permissions.includes(PERM.COST);
    return {
      canSeeCost,
      userName: user.name,
      today: {
        sales: round2(today.sales),
        profit: canSeeCost ? round2(today.profit) : null,
        orders: today.orders,
        items: today.items,
        returnAmount: round2(todayRet.amount),
        returnItems: todayRet.items,
        returnCount: todayRet.count,
      },
      yesterday: {
        sales: round2(yesterday.sales),
        profit: canSeeCost ? round2(yesterday.profit) : null,
      },
      month: {
        sales: round2(month.sales),
        profit: canSeeCost ? round2(month.profit) : null,
        orders: month.orders,
        items: month.items,
        returnAmount: round2(monthRet.amount),
        returnItems: monthRet.items,
        returnCount: monthRet.count,
      },
      lastMonth: {
        sales: round2(lastMonth.sales),
        profit: canSeeCost ? round2(lastMonth.profit) : null,
      },
      mom: {
        sales: this.ratio(month.sales, lastMonth.sales),
        profit: canSeeCost ? this.ratio(month.profit, lastMonth.profit) : null,
      },
      dod: {
        sales: this.ratio(today.sales, yesterday.sales),
        profit: canSeeCost ? this.ratio(today.profit, yesterday.profit) : null,
      },
      /** 本月本人出入库作业量 */
      moves: {
        inCount: moveAgg.in.count,
        inItems: moveAgg.in.items,
        outCount: moveAgg.out.count,
        outItems: moveAgg.out.items,
        lossCount: moveAgg.loss.count,
        supplierCount: moveAgg.supplier.count,
        transferCount: moveAgg.transfer.count,
      },
      topProducts,
    };
  }

  /**
   * 个人总览的趋势图：只统计本人经手的单
   * range: day14 | month | monthPick | month12 | custom
   */
  @Guard(PERM.DASHBOARD)
  @Get('personal-trend')
  async personalTrend(
    @Query('storeId') storeId: string,
    @Query('range') range: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    range = range || 'day14';
    const base = { ...this.storeWhere(user!, storeId), operatorId: user!.id };
    const canSeeCost = user.permissions.includes(PERM.COST);

    let start: dayjs.Dayjs;
    let end: dayjs.Dayjs;
    let unit: 'day' | 'month' = 'day';

    const now = dayjs();
    if (range === 'day14') {
      start = now.subtract(13, 'day').startOf('day');
      end = now.endOf('day');
    } else if (range === 'month' || range === 'monthPick') {
      const m = month ? dayjs(month) : now;
      start = m.startOf('month');
      end = m.endOf('month');
    } else if (range === 'month12') {
      start = now.subtract(11, 'month').startOf('month');
      end = now.endOf('month');
      unit = 'month';
    } else if (range === 'custom') {
      if (!from || !to) throw new BadRequestException('请选择起止日期');
      start = dayjs(from).startOf('day');
      end = dayjs(to).endOf('day');
      if (end.diff(start, 'day') > 92) unit = 'month';
    } else {
      start = now.subtract(13, 'day').startOf('day');
      end = now.endOf('day');
    }

    const orders = await this.prisma.order.findMany({
      where: { ...base, createdAt: { gte: start.toDate(), lte: end.toDate() } },
      select: {
        totalAmount: true,
        totalCost: true,
        totalProfit: true,
        itemCount: true,
        createdAt: true,
        type: true,
      },
    });
    const returnRows = await this.prisma.salesReturn.findMany({
      where: { ...base, createdAt: { gte: start.toDate(), lte: end.toDate() } },
      select: { refundAmount: true, quantity: true, createdAt: true },
    });

    const buckets: Array<{
      label: string;
      sales: number;
      profit: number;
      orders: number;
      items: number;
      returns: number;
      returnItems: number;
    }> = [];
    const indexMap = new Map<string, number>();
    const push = (key: string, label: string) => {
      if (!indexMap.has(key)) {
        indexMap.set(key, buckets.length);
        buckets.push({ label, sales: 0, profit: 0, orders: 0, items: 0, returns: 0, returnItems: 0 });
      }
      return indexMap.get(key)!;
    };

    const stepUnit = unit === 'day' ? 'day' : 'month';
    let cursor = start.clone().startOf(stepUnit as any);
    while (cursor.isBefore(end) || (stepUnit === 'day' && cursor.isSame(end, 'day'))) {
      push(
        cursor.format(stepUnit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'),
        cursor.format(stepUnit === 'day' ? 'MM-DD' : 'YYYY-MM'),
      );
      cursor = cursor.add(1, stepUnit as any);
    }
    for (const o of orders) {
      const k = dayjs(o.createdAt).format(stepUnit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM');
      const idx = indexMap.get(k);
      if (idx == null) continue;
      buckets[idx].sales += o.totalAmount;
      buckets[idx].profit += o.totalProfit;
      if (o.type !== 'RETURN') buckets[idx].orders += 1;
      buckets[idx].items += o.itemCount;
    }
    for (const r of returnRows) {
      const k = dayjs(r.createdAt).format(stepUnit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM');
      const idx = indexMap.get(k);
      if (idx == null) continue;
      buckets[idx].returns += r.refundAmount;
      buckets[idx].returnItems += r.quantity;
    }

    const totalSales = buckets.reduce((s, b) => s + b.sales, 0);
    const totalProfit = buckets.reduce((s, b) => s + b.profit, 0);
    const totalReturns = buckets.reduce((s, b) => s + b.returns, 0);

    return {
      unit,
      range,
      labels: buckets.map((b) => b.label),
      sales: buckets.map((b) => round2(b.sales)),
      profit: canSeeCost ? buckets.map((b) => round2(b.profit)) : [],
      orders: buckets.map((b) => b.orders),
      items: buckets.map((b) => b.items),
      returns: buckets.map((b) => round2(b.returns)),
      returnItems: buckets.map((b) => b.returnItems),
      totalSales: round2(totalSales),
      totalReturns: round2(totalReturns),
      totalProfit: canSeeCost ? round2(totalProfit) : null,
      canSeeCost,
    };
  }

  /** 多店对比（管理员总览用） */
  @Guard(PERM.DASHBOARD)
  @Get('by-store')
  async byStore(@Query('range') range: string = 'month', @CurrentUser() user: AuthUser) {
    const now = dayjs();
    const start = range === 'day' ? now.startOf('day') : now.startOf('month');
    const where: any = { createdAt: { gte: start.toDate() } };
    if (user.role !== 'ADMIN') where.storeId = user.storeId ?? -1;
    const grouped = await this.prisma.order.groupBy({
      by: ['storeId'],
      where,
      _sum: { totalAmount: true, totalProfit: true, itemCount: true },
      _count: { _all: true },
    });
    // 单数单独数一遍真实成交单，退货冲减单不算
    const saleCounts = await this.prisma.order.groupBy({
      by: ['storeId'],
      where: { ...where, type: 'SALE' },
      _count: { _all: true },
    });
    const saleCountMap = new Map(saleCounts.map((g: any) => [g.storeId, g._count._all]));
    const stores = await this.prisma.store.findMany();
    const smap = new Map(stores.map((s) => [s.id, s.name]));
    const canSeeCost = user.permissions.includes(PERM.COST);
    return grouped
      .map((g: any) => ({
        storeId: g.storeId,
        storeName: smap.get(g.storeId) || '未知门店',
        sales: round2(g._sum.totalAmount || 0),
        profit: canSeeCost ? round2(g._sum.totalProfit || 0) : null,
        items: g._sum.itemCount || 0,
        orders: saleCountMap.get(g.storeId) || 0,
      }))
      .sort((a, b) => b.sales - a.sales);
  }
}
