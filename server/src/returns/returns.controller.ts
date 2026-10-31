import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Guard, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/user.decorator';
import { PERM } from '../common/permissions';
import { resolvePaging, paging } from '../common/paging';
import { round2, lineAmount, subAmount, sumAmount } from '../common/money';

function genReturnNo() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
  return `R${stamp}${Math.floor(Math.random() * 900 + 100)}`;
}

@Controller('returns')
export class ReturnsController {
  constructor(private prisma: PrismaService) {}

  private sid(user: AuthUser, storeId?: string | number) {
    if (user.role === 'ADMIN') {
      const v = storeId === undefined || storeId === '' ? null : Number(storeId);
      return v && isFinite(v) ? v : null;
    }
    return user.storeId ?? null;
  }

  /** 扫码 / 输入编码查商品（退货用：带出档案价、库存、成本） */
  @Guard(PERM.RETURN_HANDLE)
  @Get('scan')
  async scan(
    @Query('code') code: string,
    @Query('storeId') storeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const sid = this.sid(user, storeId);
    if (!sid) throw new BadRequestException('请先选择门店');
    const kw = (code || '').trim();
    if (!kw) throw new BadRequestException('请输入编码');

    const product = await this.prisma.product.findFirst({
      where: { OR: [{ sku: kw }, { barcode: kw }] },
    });
    if (!product) return { found: false };

    const stock = await this.prisma.stock.findUnique({
      where: { storeId_productId: { storeId: sid, productId: product.id } },
    });

    return {
      found: true,
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        image: product.image,
        barcode: product.barcode,
        salePrice: product.salePrice ?? stock?.salePrice ?? 0,
        stock: stock?.quantity ?? 0,
        avgCost: user.permissions.includes(PERM.COST) ? stock?.avgCost ?? 0 : null,
      },
    };
  }

  /**
   * 找可关联的销售单
   * - 传 orderNo：精确找那张单，返回单里该商品的可退明细
   * - 只传 sku：按时间从近到远列出卖过这件商品的订单
   */
  @Guard(PERM.RETURN_HANDLE)
  @Get('orders')
  async findOrders(
    @Query('sku') sku: string,
    @Query('orderNo') orderNo: string,
    @Query('storeId') storeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const sid = this.sid(user, storeId);
    if (!sid) throw new BadRequestException('请先选择门店');
    const kw = (sku || '').trim();

    if (orderNo && orderNo.trim()) {
      const order = await this.prisma.order.findFirst({
        where: { orderNo: orderNo.trim(), storeId: sid, type: 'SALE' },
        include: { items: true, store: true, operator: true },
      });
      if (!order) throw new BadRequestException('没有找到这张销售单（可能不是本店的单）');
      const items = order.items
        .filter((it) => !kw || it.sku === kw)
        .map((it) => ({
          itemId: it.id,
          sku: it.sku,
          name: it.name,
          quantity: it.quantity,
          returnedQty: it.returnedQty,
          returnable: it.quantity - it.returnedQty,
          unitPrice: it.unitPrice,
          createdAt: order.createdAt,
        }));
      if (!items.length) throw new BadRequestException('这张单里没有该商品');
      return {
        mode: 'order',
        order: {
          id: order.id,
          orderNo: order.orderNo,
          createdAt: order.createdAt,
          storeName: order.store?.name,
          operator: order.operator?.name || '-',
          totalAmount: order.totalAmount,
        },
        items,
      };
    }

    if (!kw) throw new BadRequestException('请提供商品货号或订单号');
    // 按货号找：最近卖过这件商品的单，由近到远
    const rows = await this.prisma.orderItem.findMany({
      where: {
        sku: kw,
        order: { storeId: sid, type: 'SALE' },
      },
      include: { order: { include: { store: true, operator: true } } },
      orderBy: { order: { createdAt: 'desc' } },
      take: 20,
    });
    return {
      mode: 'sku',
      items: rows
        .filter((r) => r.quantity - r.returnedQty > 0)
        .map((r) => ({
          itemId: r.id,
          orderId: r.orderId,
          orderNo: r.order.orderNo,
          createdAt: r.order.createdAt,
          storeName: r.order.store?.name,
          operator: r.order.operator?.name || '-',
          sku: r.sku,
          name: r.name,
          quantity: r.quantity,
          returnedQty: r.returnedQty,
          returnable: r.quantity - r.returnedQty,
          unitPrice: r.unitPrice,
        })),
    };
  }

  /** 执行退货 */
  @Guard(PERM.RETURN_HANDLE)
  @Post()
  async create(
    @Body()
    body: {
      storeId: number;
      sku: string;
      quantity: number;
      unitPrice: number;
      orderId?: number;
      itemId?: number;
      remark?: string;
    },
    @CurrentUser() user: AuthUser,
  ) {
    const sid = this.sid(user, body.storeId);
    if (!sid) throw new BadRequestException('请先选择门店');
    const sku = (body.sku || '').trim();
    const qty = Math.floor(Number(body.quantity));
    const price = Number(body.unitPrice);
    if (!sku) throw new BadRequestException('请先扫描商品');
    if (!isFinite(qty) || qty <= 0) throw new BadRequestException('退货件数必须大于 0');
    if (!isFinite(price) || price < 0) throw new BadRequestException('退货单价不正确');

    const product = await this.prisma.product.findUnique({ where: { sku } });
    if (!product) throw new BadRequestException(`货号「${sku}」不存在`);
    const stock = await this.prisma.stock.findUnique({
      where: { storeId_productId: { storeId: sid, productId: product.id } },
    });
    if (!stock) throw new BadRequestException('该商品在本店没有库存记录，无法退货');

    // ---------- 关联订单退货 ----------
    if (body.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: Number(body.orderId) },
        include: { items: true },
      });
      if (!order) throw new BadRequestException('关联的销售单不存在');
      if (order.storeId !== sid) throw new BadRequestException('关联订单不属于当前门店');
      if (order.type !== 'SALE') throw new BadRequestException('不能对退货冲减单再次退货');

      const item = order.items.find((it) => it.sku === sku);
      if (!item) throw new BadRequestException('这张单里没有该商品');
      const returnable = item.quantity - item.returnedQty;
      if (qty > returnable) {
        throw new BadRequestException(`最多只能退 ${returnable} 件（已退 ${item.returnedQty} 件）`);
      }

      const unitCost = round2(item.unitCost);
      const amount = lineAmount(price, qty);
      const cost = lineAmount(unitCost, qty);
      const profit = subAmount(amount, cost);

      const ret = await this.prisma.retryOnBusy(() =>
        this.prisma.$transaction(async (tx) => {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { returnedQty: { increment: qty } },
          });
          // 营业额 / 成本 / 毛利直接回算到原单那一天的账上
          const newAmount = subAmount(order.totalAmount, amount);
          const newCost = subAmount(order.totalCost, cost);
          await tx.order.update({
            where: { id: order.id },
            data: {
              totalAmount: newAmount,
              totalCost: newCost,
              totalProfit: subAmount(newAmount, newCost),
              itemCount: order.itemCount - qty,
              returnAmount: sumAmount([order.returnAmount, amount]),
              returnCount: order.returnCount + qty,
            },
          });
          await tx.stock.update({
            where: { id: stock.id },
            data: { quantity: { increment: qty } },
          });
          return tx.salesReturn.create({
            data: {
              returnNo: genReturnNo(),
              storeId: sid,
              orderId: order.id,
              productId: product.id,
              sku,
              name: product.name,
              quantity: qty,
              unitPrice: round2(price),
              unitCost,
              refundAmount: amount,
              refundCost: cost,
              refundProfit: profit,
              linked: true,
              operatorId: user.id,
              remark: body.remark || null,
            },
            include: { order: true, store: true, operator: true, product: true },
          });
        }),
      );

      const latest = await this.prisma.stock.findUnique({ where: { id: stock.id } });
      return { ok: true, linked: true, ret: this.formatReturn(ret), stock: latest?.quantity ?? 0 };
    }

    // ---------- 未关联订单：生成一张负数冲减单，抵当天营业额 ----------
    const unitCost = round2(stock.avgCost);
    const amount = lineAmount(price, qty);
    const cost = lineAmount(unitCost, qty);
    const profit = subAmount(amount, cost);
    const returnNo = genReturnNo();

    const result = await this.prisma.retryOnBusy(() =>
      this.prisma.$transaction(async (tx) => {
        const offsetOrder = await tx.order.create({
          data: {
            orderNo: `RF${returnNo.slice(1)}`,
            storeId: sid,
            type: 'RETURN',
            totalAmount: -amount,
            totalCost: -cost,
            totalProfit: -profit,
            itemCount: -qty,
            operatorId: user.id,
            remark: body.remark || `未关联订单退货：${product.name} × ${qty}`,
            items: {
              create: [
                {
                  productId: product.id,
                  sku,
                  name: product.name,
                  quantity: -qty,
                  unitPrice: round2(price),
                  listPrice: null,
                  unitCost,
                  subtotal: -amount,
                  profit: -profit,
                },
              ],
            },
          },
        });
        await tx.stock.update({
          where: { id: stock.id },
          data: { quantity: { increment: qty } },
        });
        const ret = await tx.salesReturn.create({
          data: {
            returnNo,
            storeId: sid,
            productId: product.id,
            sku,
            name: product.name,
            quantity: qty,
            unitPrice: round2(price),
            unitCost,
            refundAmount: amount,
            refundCost: cost,
            refundProfit: profit,
            linked: false,
            offsetOrderId: offsetOrder.id,
            operatorId: user.id,
            remark: body.remark || null,
          },
          include: { store: true, operator: true, product: true },
        });
        return { ret, offsetOrder };
      }),
    );

    const latest = await this.prisma.stock.findUnique({ where: { id: stock.id } });
    return {
      ok: true,
      linked: false,
      ret: this.formatReturn(result.ret),
      offsetOrderNo: result.offsetOrder.orderNo,
      stock: latest?.quantity ?? 0,
    };
  }

  /** 退货记录 */
  @Guard(PERM.RETURN_VIEW)
  @Get('records')
  async records(
    @Query('storeId') storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('keyword') keyword?: string,
    @Query('linked') linked?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    const where: any = {};
    const sid = this.sid(user, storeId);
    if (sid) where.storeId = sid;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(`${to} 23:59:59`);
    }
    if (keyword && keyword.trim()) {
      const kw = keyword.trim();
      where.OR = [
        { returnNo: { contains: kw } },
        { sku: { contains: kw } },
        { name: { contains: kw } },
        { order: { orderNo: { contains: kw } } },
      ];
    }
    if (linked === '1') where.linked = true;
    if (linked === '0') where.linked = false;

    const { skip, take, page: p, pageSize: size } = resolvePaging(page, pageSize);
    const total = await this.prisma.salesReturn.count({ where });
    const rows = await this.prisma.salesReturn.findMany({
      where,
      include: { order: true, store: true, operator: true, product: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    const sum = await this.prisma.salesReturn.aggregate({
      where,
      _sum: { refundAmount: true, refundProfit: true, quantity: true },
    });
    const res = paging(total, p, size, rows.map((r) => this.formatReturn(r)));
    return {
      ...res,
      summary: {
        refundAmount: round2(sum._sum.refundAmount),
        refundProfit: round2(sum._sum.refundProfit),
        quantity: sum._sum.quantity || 0,
      },
    };
  }

  /**
   * 撤销退货（只支持未关联订单的）。
   * 会把库存扣回去、删掉那张负数冲减单（营业额自动恢复），并删除退货记录。
   * 权限：管理员可撤销全部；其他人只能撤销自己处理的，
   * 想撤销别人的需要「修改他人销售单」权限（sale:edit:all）。
   */
  @Guard(PERM.SALE_EDIT)
  @Delete(':id')
  async revoke(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const ret = await this.prisma.salesReturn.findUnique({ where: { id: +id } });
    if (!ret) throw new BadRequestException('退货记录不存在');
    if (ret.linked) {
      throw new BadRequestException('已关联原订单的退货不能直接撤销，请到销售记录里修改对应订单');
    }

    const canAll =
      user.role === 'ADMIN' || (user.permissions || []).includes(PERM.SALE_EDIT_ALL);
    if (!canAll && ret.operatorId !== user.id) {
      throw new ForbiddenException('只能撤销自己处理的退货');
    }
    if (user.role !== 'ADMIN' && ret.storeId !== user.storeId) {
      throw new ForbiddenException('无权撤销其它门店的退货');
    }

    const stock = await this.prisma.stock.findUnique({
      where: { storeId_productId: { storeId: ret.storeId, productId: ret.productId } },
    });
    if (!stock) throw new BadRequestException('该商品在本店没有库存记录');
    if (stock.quantity < ret.quantity) {
      throw new BadRequestException(
        `当前库存只有 ${stock.quantity} 件，不足以撤销 ${ret.quantity} 件退货（货可能已经卖掉了）`,
      );
    }

    await this.prisma.retryOnBusy(() =>
      this.prisma.$transaction(async (tx) => {
        // 退货时加了库存，撤销要把货再扣回去
        await tx.stock.update({
          where: { id: stock.id },
          data: { quantity: { decrement: ret.quantity } },
        });
        if (ret.offsetOrderId) {
          await tx.orderItem.deleteMany({ where: { orderId: ret.offsetOrderId } });
          await tx.order.delete({ where: { id: ret.offsetOrderId } });
        }
        await tx.salesReturn.delete({ where: { id: ret.id } });
      }),
    );

    const latest = await this.prisma.stock.findUnique({ where: { id: stock.id } });
    return {
      ok: true,
      stock: latest?.quantity ?? 0,
      refundAmount: ret.refundAmount,
      quantity: ret.quantity,
    };
  }

  private formatReturn(r: any) {
    return {
      id: r.id,
      returnNo: r.returnNo,
      sku: r.sku,
      name: r.name,
      image: r.product?.image ?? null,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      refundAmount: r.refundAmount,
      refundCost: r.refundCost,
      refundProfit: r.refundProfit,
      linked: r.linked,
      orderId: r.orderId,
      orderNo: r.order?.orderNo ?? null,
      offsetOrderId: r.offsetOrderId,
      operatorId: r.operatorId ?? null,
      storeId: r.storeId,
      storeName: r.store?.name ?? null,
      operator: r.operator?.name || '-',
      remark: r.remark,
      createdAt: r.createdAt,
    };
  }
}
