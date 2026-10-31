import { Body, Controller, Get, Post, Query, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Guard, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/user.decorator';
import { PERM } from '../common/permissions';
import { resolvePaging, paging } from '../common/paging';
import { round2, lineAmount, sumAmount } from '../common/money';

@Controller('inventory')
export class InventoryController {
  constructor(private prisma: PrismaService) {}

  /** 门店范围解析：非管理员只能操作自己所属门店 */
  private resolveStore(user: AuthUser, storeId: any): number {
    if (user.role === 'ADMIN') {
      const id = +storeId;
      if (!id) throw new BadRequestException('请先选择要入库的门店');
      return id;
    }
    if (!user.storeId) throw new BadRequestException('当前账号未分配门店');
    return user.storeId;
  }

  /** 扫码解析：二维码/条码内容 -> 商品（支持货号精确或模糊匹配首个） */
  @Guard(PERM.INVENTORY_IN)
  @Get('scan')
  async scan(@Query('code') code: string, @Query('storeId') storeId: string, @CurrentUser() user: AuthUser) {
    if (!code) throw new BadRequestException('扫码内容为空');
    const sid = this.resolveStore(user, storeId);
    const key = code.trim();
    let product = await this.prisma.product.findUnique({ where: { sku: key }, include: { category: true } });
    // 扫到的是商品标签上的 EAN-13 机读条码
    if (!product && /^\d{13}$/.test(key)) {
      product = await this.prisma.product.findUnique({
        where: { barcode: key },
        include: { category: true },
      });
    }
    if (!product) {
      // 支持条码里带前缀/后缀（如厂商前缀 + 货号）
      product = await this.prisma.product.findFirst({
        where: { sku: { contains: key } },
        include: { category: true },
      });
    }
    if (!product) return { found: false, code: key };
    const stock = await this.prisma.stock.findUnique({
      where: { storeId_productId: { storeId: sid, productId: product.id } },
    });
    return {
      found: true,
      product: {
        id: product.id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        image: product.image,
        categoryName: product.category?.name || null,
        stock: stock?.quantity ?? 0,
        // 档案价：成本价用于预填入库进货价（可改），销售价直接写入库存
        costPrice: product.costPrice,
        salePrice: product.salePrice,
        lastCost: stock?.avgCost ?? 0,
        lastSale: stock?.salePrice ?? 0,
      },
    };
  }

  /** 入库（扫码/手动统一入口），成本采用移动加权平均 */
  @Guard(PERM.INVENTORY_IN)
  @Post('in')
  async stockIn(
    // salePrice 已废弃：入库页不再填售价，统一取商品档案价（保留字段只为兼容旧调用，传了也不生效）
    @Body()
    body: { sku: string; costPrice: number; salePrice?: number; quantity: number; type?: string; storeId?: number },
    @CurrentUser() user: AuthUser,
  ) {
    const sid = this.resolveStore(user, body.storeId);
    const sku = (body.sku || '').trim();
    if (!sku) throw new BadRequestException('货号不能为空');
    const cost = round2(body.costPrice);
    const qty = Number(body.quantity);
    if (!isFinite(cost) || cost < 0) throw new BadRequestException('进货价不正确');
    if (!isFinite(qty) || qty <= 0) throw new BadRequestException('入库件数必须大于 0');

    let product = await this.prisma.product.findUnique({ where: { sku } });
    // 手输条码也能入库
    if (!product && /^\d{13}$/.test(sku)) {
      product = await this.prisma.product.findUnique({ where: { barcode: sku } });
    }
    if (!product) throw new BadRequestException(`货号「${sku}」不存在，请先在商品管理中新增该商品`);

    const stock = await this.prisma.stock.findUnique({
      where: { storeId_productId: { storeId: sid, productId: product.id } },
    });

    // 销售价不再在入库页填写，统一取商品档案价；
    // 档案没设过价的用该店库存现价兜底（兼容历史数据），都没有就要求先去商品管理设价
    const sale = round2(product.salePrice ?? stock?.salePrice ?? 0);
    if (!sale || sale <= 0) {
      throw new BadRequestException(
        `商品「${product.name}」还没有销售价，请先到「商品管理」中为其设置销售价后再入库`,
      );
    }

    // 移动加权平均成本：保留两位小数口径，避免均价被浮点拖到 129.4790071868 这种长小数，
    // 后续按均价结转的销售成本、毛利才会和账面金额对得上
    let avgCost = cost;
    if (stock && stock.quantity > 0) {
      avgCost = round2(
        (stock.avgCost * stock.quantity + cost * qty) / (stock.quantity + qty),
      );
    }

    // 批次 + 库存汇总必须一起成功或一起失败；SQLite 单写者锁下并发入库交给 retryOnBusy 兜底
    const updated = await this.prisma.retryOnBusy(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.stockBatch.create({
          data: {
            storeId: sid,
            productId: product.id,
            costPrice: cost,
            salePrice: sale,
            quantity: qty,
            type: body.type || 'MANUAL',
            operatorId: user.id,
          },
        });
        return tx.stock.upsert({
          where: { storeId_productId: { storeId: sid, productId: product.id } },
          create: {
            storeId: sid,
            productId: product.id,
            quantity: qty,
            avgCost,
            salePrice: sale,
          },
          update: {
            quantity: { increment: qty },
            avgCost,
            salePrice: sale,
          },
        });
      }),
    );

    return {
      success: true,
      product: { id: product.id, sku: product.sku, name: product.name, image: product.image },
      stock: updated,
    };
  }

  /**
   * 入库记录（只读）
   * 有 inventory:view 即可查看（店长/营业员默认有），无需 inventory:in 操作权限；
   * 进货价按 finance:cost 过滤，没有成本权限的账号拿到的 costPrice 为 null。
   */
  @Guard(PERM.INVENTORY_VIEW, PERM.INVENTORY_IN, PERM.STOCK_VIEW)
  @Get('records')
  async records(
    @Query('storeId') storeId: string,
    @Query('keyword') keyword?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    if (user.role !== 'ADMIN') {
      storeId = String(user.storeId ?? -1);
    }
    const where: any = {};
    if (storeId && storeId !== 'all') where.storeId = +storeId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(`${to} 23:59:59`);
    }
    if (keyword && keyword.trim()) {
      const k = keyword.trim();
      where.product = { OR: [{ sku: { contains: k } }, { name: { contains: k } }] };
    }
    const { skip, take, page: p, pageSize: size } = resolvePaging(page, pageSize);
    const total = await this.prisma.stockBatch.count({ where });
    const rows = await this.prisma.stockBatch.findMany({
      where,
      include: { product: true, store: true, operator: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    const canSeeCost = user.permissions.includes(PERM.COST);
    return paging(
      total,
      p,
      size,
      rows.map((r) => ({
        id: r.id,
        storeId: r.storeId,
        storeName: r.store?.name,
        sku: r.product.sku,
        name: r.product.name,
        image: r.product.image,
        quantity: r.quantity,
        costPrice: canSeeCost ? r.costPrice : null,
        salePrice: r.salePrice,
        type: r.type,
        operator: r.operator?.name || '-',
        createdAt: r.createdAt,
      })),
    );
  }

  /** 门店库存列表 */
  @Guard(PERM.STOCK_VIEW)
  @Get('stock')
  async stock(
    @Query('storeId') storeId: string,
    @Query('keyword') keyword?: string,
    @Query('lowOnly') lowOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    if (user.role !== 'ADMIN') storeId = String(user.storeId ?? -1);
    const where: any = {};
    if (storeId && storeId !== 'all') where.storeId = +storeId;
    if (keyword && keyword.trim()) {
      const k = keyword.trim();
      where.product = { OR: [{ sku: { contains: k } }, { name: { contains: k } }] };
    }
    if (lowOnly === 'true') where.quantity = { lte: 5 };
    const { skip, take, page: p, pageSize: size } = resolvePaging(page, pageSize);
    const total = await this.prisma.stock.count({ where });
    const rows = await this.prisma.stock.findMany({
      where,
      include: { product: { include: { category: true } }, store: true },
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
    });
    const canSeeCost = user.permissions.includes(PERM.COST);
    // 合计按筛选条件的全量算：SKU 数、总件数、库存成本（不随翻页变化）
    const all = await this.prisma.stock.findMany({
      where,
      select: { quantity: true, avgCost: true },
    });
    const res = paging(
      total,
      p,
      size,
      rows.map((s) => ({
        id: s.id,
        storeId: s.storeId,
        storeName: s.store?.name,
        productId: s.productId,
        sku: s.product.sku,
        name: s.product.name,
        image: s.product.image,
        categoryName: s.product.category?.name || null,
        quantity: s.quantity,
        salePrice: s.salePrice,
        avgCost: canSeeCost ? round2(s.avgCost) : null,
        stockValue: canSeeCost ? lineAmount(s.avgCost, s.quantity) : null,
        updatedAt: s.updatedAt,
      })),
    );
    return {
      ...res,
      summary: {
        skuCount: total,
        quantity: all.reduce((s, x) => s + x.quantity, 0),
        stockValue: canSeeCost ? sumAmount(all.map((x) => lineAmount(x.avgCost, x.quantity))) : 0,
      },
    };
  }
}
