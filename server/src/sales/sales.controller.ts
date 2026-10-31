import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Guard, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/user.decorator';
import { PERM } from '../common/permissions';
import { resolvePaging, paging } from '../common/paging';
import { round2, lineAmount, lineProfit, sumAmount, subAmount } from '../common/money';

function genOrderNo() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
  return `S${stamp}${Math.floor(Math.random() * 900 + 100)}`;
}

@Controller('sales')
export class SalesController {
  constructor(private prisma: PrismaService) {}

  /** 销售记账：购物车统一结算入账 */
  @Guard(PERM.SALE_CREATE)
  @Post()
  async create(
    @Body() body: { storeId: number; items: Array<{ sku: string; quantity: number; unitPrice?: number }>; remark?: string },
    @CurrentUser() user: AuthUser,
  ) {
    const storeId = user.role === 'ADMIN' ? +body.storeId : user.storeId;
    if (!storeId) throw new BadRequestException('请先选择门店');
    if (!body.items || !body.items.length) throw new BadRequestException('购物车为空');

    let itemCount = 0;
    const prepared: any[] = [];
    // 明细逐笔取整到「分」，订单总额 = Σ 已取整的明细，前端明细合计与订单总额永远一致
    const amountLines: number[] = [];
    const costLines: number[] = [];

    for (const it of body.items) {
      const sku = (it.sku || '').trim();
      const qty = Number(it.quantity);
      if (!sku || !isFinite(qty) || qty <= 0) throw new BadRequestException('商品件数不正确');
      const product = await this.prisma.product.findUnique({ where: { sku } });
      if (!product) throw new BadRequestException(`货号「${sku}」不存在`);
      const stock = await this.prisma.stock.findUnique({
        where: { storeId_productId: { storeId, productId: product.id } },
      });
      if (!stock || stock.quantity < qty) {
        throw new BadRequestException(
          `「${product.name}」库存不足（现有 ${stock?.quantity ?? 0} 件）`,
        );
      }
      const rawPrice: any = it.unitPrice;
      const unitPrice =
        rawPrice !== null && rawPrice !== undefined && rawPrice !== '' && !isNaN(Number(rawPrice))
          ? Number(rawPrice)
          : stock.salePrice;
      if (!isFinite(unitPrice) || unitPrice <= 0) throw new BadRequestException('销售价不正确');
      const unitCost = round2(stock.avgCost);
      const subtotal = lineAmount(unitPrice, qty);
      const cost = lineAmount(unitCost, qty);
      const profit = lineProfit(unitPrice, unitCost, qty);
      // 记下当时档案销售价，日后用来判断这一件是优惠还是加价（档案价以后会变，必须快照）
      const listPrice = round2(product.salePrice ?? stock.salePrice ?? unitPrice);
      amountLines.push(subtotal);
      costLines.push(cost);
      itemCount += qty;
      prepared.push({
        product,
        stock,
        quantity: qty,
        unitPrice: round2(unitPrice),
        listPrice,
        unitCost,
        subtotal,
        cost,
        profit,
      });
    }

    const totalAmount = sumAmount(amountLines);
    const totalCost = sumAmount(costLines);
    const totalProfit = subAmount(totalAmount, totalCost);

    // 写库走事务 + 写冲突自动重试：
    // SQLite 是单写者锁，多家门店同时开单偶发 SQLITE_BUSY；MySQL 下可能是死锁，
    // 这两种都由 retryOnBusy 兜底重试，业务侧不用各自 await 循环。
    const order = await this.prisma.retryOnBusy(() =>
      this.prisma.$transaction(async (tx) => {
        // 事务内二次校验库存：事务开始前的读取可能已被并发 modifies 覆盖
        for (const p of prepared) {
          const s = await tx.stock.findUnique({ where: { id: p.stock.id } });
          if (!s || s.quantity < p.quantity) {
            throw new BadRequestException(
              `「${p.product.name}」库存不足（现有 ${s?.quantity ?? 0} 件）`,
            );
          }
        }
        const created = await tx.order.create({
          data: {
            orderNo: genOrderNo(),
            storeId,
            totalAmount,
            totalCost,
            totalProfit,
            itemCount,
            operatorId: user.id,
            remark: body.remark || null,
            items: {
              create: prepared.map((p) => ({
                productId: p.product.id,
                sku: p.product.sku,
                name: p.product.name,
                quantity: p.quantity,
                unitPrice: p.unitPrice,
                listPrice: p.listPrice,
                unitCost: p.unitCost,
                subtotal: p.subtotal,
                profit: p.profit,
              })),
            },
          },
          include: { items: true, store: true, operator: true },
        });
        for (const p of prepared) {
          await tx.stock.update({
            where: { id: p.stock.id },
            data: { quantity: { decrement: p.quantity } },
          });
        }
        return created;
      }),
    );

    return this.format(order, user);
  }

  @Guard(PERM.SALE_VIEW)
  @Get('orders')
  async list(
    @Query('storeId') storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('keyword') keyword?: string,
    @Query('mine') mine?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    if (user.role !== 'ADMIN') storeId = String(user.storeId ?? -1);
    const where: any = {};
    if (storeId && storeId !== 'all') where.storeId = +storeId;
    // 只看自己开的单（"个人销售记录"）
    if (mine === '1' || mine === 'true') where.operatorId = user.id;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(`${to} 23:59:59`);
    }
    if (keyword && keyword.trim()) {
      where.orderNo = { contains: keyword.trim() };
    }
    const { skip, take, page: p, pageSize: size } = resolvePaging(page, pageSize);
    const total = await this.prisma.order.count({ where });
    const rows = await this.prisma.order.findMany({
      where,
      include: { store: true, operator: true, items: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    // 合计按筛选条件的全量算，不受分页影响（否则翻页时合计会变成"本页合计"）
    const sum = await this.prisma.order.aggregate({
      where,
      _sum: { totalAmount: true, totalProfit: true, itemCount: true },
    });
    // 退货冲减单要把对应退货记录 id 带出去，前端才能「撤销」
    const offsetIds = rows.filter((o: any) => (o.type || 'SALE') === 'RETURN').map((o: any) => o.id);
    const revMap = new Map<number, any>();
    if (offsetIds.length) {
      const rets = await this.prisma.salesReturn.findMany({
        where: { offsetOrderId: { in: offsetIds } },
      });
      for (const r of rets) revMap.set(r.offsetOrderId as number, r);
    }
    const res = paging(
      total,
      p,
      size,
      rows.map((o) => {
        const d: any = this.format(o, user);
        const r = revMap.get(o.id);
        if (r) {
          d.returnId = r.id;
          d.returnOperatorId = r.operatorId ?? null;
        }
        return d;
      }),
    );
    return {
      ...res,
      summary: {
        totalAmount: round2(sum._sum.totalAmount),
        totalProfit: round2(sum._sum.totalProfit),
        itemCount: sum._sum.itemCount || 0,
      },
    };
  }

  @Guard(PERM.SALE_VIEW)
  @Get('orders/:id')
  async detail(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    const o = await this.prisma.order.findUnique({
      where: { id: +id },
      include: { store: true, operator: true, items: { include: { product: true } } },
    });
    if (!o) throw new BadRequestException('订单不存在');
    if (user.role !== 'ADMIN' && o.storeId !== user.storeId) throw new BadRequestException('无权查看');
    // format 已统一处理明细（含每件优惠/加价与成本权限），这里不再二次映射
    const res: any = this.format(o, user);
    if (res.type === 'RETURN') {
      const ret = await this.prisma.salesReturn.findFirst({ where: { offsetOrderId: o.id } });
      if (ret) {
        res.returnId = ret.id;
        res.returnOperatorId = ret.operatorId ?? null;
      }
    }
    return res;
  }

  /**
   * 修改销售单：明细的单价 / 件数 + 备注。
   * 件数变化会同步库存（减少回库、增加扣减），并重算营业额与毛利。
   * 权限：管理员可改全部；其他人默认只能改自己开的单，
   * 想改他人单需要管理员在「账号权限」里追加 sale:edit:all。
   */
  @Guard(PERM.SALE_EDIT)
  @Put('orders/:id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      items?: Array<{ id: number; quantity: number; unitPrice: number }>;
      remark?: string;
    },
    @CurrentUser() user: AuthUser,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: +id },
      include: { store: true, operator: true, items: true },
    });
    if (!order) throw new BadRequestException('订单不存在');
    if ((order as any).type === 'RETURN') {
      throw new BadRequestException('退货冲减单不能修改，请到退货处理里操作');
    }

    const canEditAll =
      user.role === 'ADMIN' || (user.permissions || []).includes(PERM.SALE_EDIT_ALL);
    if (!canEditAll && order.operatorId !== user.id) {
      throw new ForbiddenException('只能修改自己开的单');
    }
    if (user.role !== 'ADMIN' && order.storeId !== user.storeId) {
      throw new ForbiddenException('无权修改其它门店的订单');
    }

    const editItems = body.items || [];
    if (!editItems.length) throw new BadRequestException('缺少订单明细');
    if (editItems.length !== order.items.length) throw new BadRequestException('明细数量不一致');

    const originMap = new Map(order.items.map((it) => [it.id, it]));
    for (const e of editItems) {
      if (!originMap.has(+e.id)) throw new BadRequestException('订单明细不存在');
    }

    let itemCount = 0;
    const amountLines: number[] = [];
    const costLines: number[] = [];
    const updates: Array<{
      id: number;
      quantity: number;
      unitPrice: number;
      subtotal: number;
      profit: number;
    }> = [];
    // 件数增减导致的库存变动，先全部校验完再一起写
    const deltas: Array<{ stockId: number; delta: number }> = [];

    for (const e of editItems) {
      const origin = originMap.get(+e.id)!;
      // 前端传的是「有效件数」（已扣掉退掉的），原始件数 = 有效件数 + 已退件数
      const effQty = Math.floor(Number(e.quantity));
      const price = Number(e.unitPrice);
      const returned = origin.returnedQty || 0;
      if (!isFinite(effQty) || effQty < 0) throw new BadRequestException('件数不能小于 0');
      if (effQty === 0 && returned === 0) throw new BadRequestException('件数必须大于 0');
      if (!isFinite(price) || price <= 0) throw new BadRequestException('单价必须大于 0');

      const totalQty = effQty + returned;
      const delta = totalQty - origin.quantity;
      if (delta !== 0) {
        const stock = await this.prisma.stock.findUnique({
          where: {
            storeId_productId: { storeId: order.storeId, productId: origin.productId },
          },
        });
        if (!stock) throw new BadRequestException(`「${origin.name}」在该门店没有库存记录`);
        if (delta > 0 && stock.quantity < delta) {
          throw new BadRequestException(
            `「${origin.name}」库存不足（现有 ${stock.quantity} 件），无法增加 ${delta} 件`,
          );
        }
        deltas.push({ stockId: stock.id, delta });
      }

      // 订单金额只算有效件数：退掉的部分已经在退货时冲减过，不能在这里又被加回来
      amountLines.push(lineAmount(price, effQty));
      costLines.push(lineAmount(origin.unitCost, effQty));
      itemCount += effQty;
      updates.push({
        id: origin.id,
        quantity: totalQty,
        unitPrice: round2(price),
        subtotal: lineAmount(price, totalQty),
        profit: lineProfit(price, origin.unitCost, totalQty),
      });
    }

    const totalAmount = sumAmount(amountLines);
    const totalCost = sumAmount(costLines);

    await this.prisma.retryOnBusy(() =>
      this.prisma.$transaction(async (tx) => {
        for (const u of updates) {
          await tx.orderItem.update({
            where: { id: u.id },
            data: {
              quantity: u.quantity,
              unitPrice: u.unitPrice,
              subtotal: u.subtotal,
              profit: u.profit,
            },
          });
        }
        for (const d of deltas) {
          // delta 为正=卖多了扣库存；为负=退回，decrement 负数即增加
          await tx.stock.update({
            where: { id: d.stockId },
            data: { quantity: { decrement: d.delta } },
          });
        }
        await tx.order.update({
          where: { id: order.id },
          data: {
            totalAmount,
            totalCost,
            totalProfit: subAmount(totalAmount, totalCost),
            itemCount,
            remark: body.remark !== undefined ? body.remark || null : order.remark,
          },
        });
      }),
    );

    const fresh = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: { store: true, operator: true, items: { include: { product: true } } },
    });
    return this.format(fresh, user);
  }

  private format(o: any, user: AuthUser) {
    const canSeeCost = user?.permissions?.includes(PERM.COST);
    const items = (o.items || []).map((it: any) => {
      const listPrice = it.listPrice ?? null;
      const returned = it.returnedQty || 0;
      // 有效件数：退掉的不再计入营业额，价格调整也只按有效件数算
      const effQty = it.quantity - returned;
      // 单件的价格调整 =（成交价 - 档案价）× 有效件数
      const diff = listPrice === null ? null : lineAmount(it.unitPrice - listPrice, effQty);
      return {
        id: it.id,
        sku: it.sku,
        name: it.name,
        image: it.product?.image ?? null,
        quantity: it.quantity,
        returnedQty: returned,
        effQty,
        unitPrice: it.unitPrice,
        listPrice,
        diff,
        subtotal: it.subtotal,
        unitCost: canSeeCost ? it.unitCost : null,
        profit: canSeeCost ? it.profit : null,
      };
    });

    // 整单的净价差：负数=优惠，正数=加价；历史订单没有 listPrice，按未调整处理
    // 全部按「有效件数」折算，和已扣减退货的营业额保持同一口径
    let listAmount = 0;
    let hasAdjust = false;
    for (const it of o.items || []) {
      const lp = it.listPrice;
      const effQty = it.quantity - (it.returnedQty || 0);
      if (lp === null || lp === undefined) {
        listAmount += lineAmount(it.unitPrice, effQty);
        continue;
      }
      listAmount += lineAmount(lp, effQty);
      if (effQty > 0 && Math.abs(lp - it.unitPrice) > 0.001) hasAdjust = true;
    }
    const priceDiff = subAmount(o.totalAmount, listAmount);
    // MIXED：明细里有优惠也有加价，净额为 0，表格里只能显示「-」，前端会加问号提示
    const adjustFlag = !hasAdjust
      ? 'NONE'
      : priceDiff < 0
        ? 'DISCOUNT'
        : priceDiff > 0
          ? 'MARKUP'
          : 'MIXED';

    return {
      id: o.id,
      orderNo: o.orderNo,
      storeId: o.storeId,
      storeName: o.store?.name || null,
      totalAmount: o.totalAmount,
      type: o.type || 'SALE',
      returnAmount: o.returnAmount || 0,
      returnCount: o.returnCount || 0,
      listAmount: round2(listAmount),
      priceDiff,
      adjustFlag,
      totalCost: canSeeCost ? o.totalCost : null,
      totalProfit: canSeeCost ? o.totalProfit : null,
      itemCount: o.itemCount,
      operator: o.operator?.name || '-',
      operatorId: o.operatorId ?? null,
      remark: o.remark,
      createdAt: o.createdAt,
      items,
    };
  }
}
