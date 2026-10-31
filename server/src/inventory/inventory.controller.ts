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
  private resolveStore(user: AuthUser, storeId: any, action = '入库'): number {
    if (user.role === 'ADMIN') {
      const id = +storeId;
      if (!id) throw new BadRequestException(`请先选择要${action}的门店`);
      return id;
    }
    if (!user.storeId) throw new BadRequestException('当前账号未分配门店');
    return user.storeId;
  }

  /** 扫码解析：二维码/条码内容 -> 商品（支持货号精确或模糊匹配首个） */
  @Guard(PERM.INVENTORY_IN)
  @Get('scan')
  async scan(
    @Query('code') code: string,
    @Query('storeId') storeId: string,
    @Query('action') action: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (!code) throw new BadRequestException('扫码内容为空');
    const sid = this.resolveStore(user, storeId, action === 'out' ? '出库' : '入库');
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
    // 成本价属于敏感信息：没有 finance:cost 权限的账号一律不下发，
    // 否则员工扫个码就能看到进货价，等于把成本暴露给所有人。
    const canSeeCost = user.permissions.includes(PERM.COST);
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
        costPrice: canSeeCost ? product.costPrice : null,
        salePrice: product.salePrice,
        lastCost: canSeeCost ? stock?.avgCost ?? 0 : null,
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
            direction: 'IN',
            type: body.type || 'MANUAL',
            totalCost: lineAmount(cost, qty),
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
   * 出库（丢失/破损、退供应商、调拔门店）
   *
   * 三种方式的账务处理完全不同：
   * - LOSS（丢失/破损）：按该店当前移动加权均价结转成本记在这条出库记录上，
   *   库存正常减少。成本留在系统里，事后可找责任人追偿（需填责任人）。
   * - SUPPLIER（退供应商）：成本清零（costPrice/totalCost 都记 0），
   *   库存正常减少。退回去的货没产生经济损失，系统里不再挂这笔成本。
   * - TRANSFER（调拔）：源店减库存并记一条出库流水，目标店加库存并记一条
   *   入库流水（方式=调拔，来源=XX店调入），两边库存此消彼长。
   */
  @Guard(PERM.INVENTORY_IN)
  @Post('out')
  async stockOut(
    @Body()
    body: {
      sku: string;
      quantity: number;
      /** LOSS=丢失/破损 SUPPLIER=退供应商 TRANSFER=调拔门店 */
      outType: string;
      /** 调拔时的目标门店 */
      targetStoreId?: number;
      /** 丢失/破损时的责任人 */
      liablePerson?: string;
      remark?: string;
      type?: string;
      storeId?: number;
    },
    @CurrentUser() user: AuthUser,
  ) {
    const sid = this.resolveStore(user, body.storeId, '出库');
    const sku = (body.sku || '').trim();
    if (!sku) throw new BadRequestException('货号不能为空');
    const qty = Number(body.quantity);
    if (!isFinite(qty) || qty <= 0) throw new BadRequestException('出库件数必须大于 0');

    const outType = (body.outType || '').toUpperCase();
    if (!['LOSS', 'SUPPLIER', 'TRANSFER'].includes(outType)) {
      throw new BadRequestException('出库方式不正确');
    }
    if (outType === 'LOSS' && !(body.liablePerson || '').trim()) {
      throw new BadRequestException('丢失/破损出库请填写责任人，便于后续追偿');
    }
    if (outType === 'TRANSFER') {
      const tid = Number(body.targetStoreId);
      if (!tid) throw new BadRequestException('调拔门店请选择要调入的门店');
      if (tid === sid) throw new BadRequestException('调入门店不能与出库门店相同');
    }

    let product = await this.prisma.product.findUnique({ where: { sku } });
    if (!product && /^\d{13}$/.test(sku)) {
      product = await this.prisma.product.findUnique({ where: { barcode: sku } });
    }
    if (!product) throw new BadRequestException(`货号「${sku}」不存在`);

    const stock = await this.prisma.stock.findUnique({
      where: { storeId_productId: { storeId: sid, productId: product.id } },
    });
    if (!stock || stock.quantity <= 0) {
      throw new BadRequestException(`商品「${product.name}」在当前门店没有库存，无法出库`);
    }
    if (qty > stock.quantity) {
      throw new BadRequestException(
        `库存不足：当前仅剩 ${stock.quantity} 件，无法出库 ${qty} 件`,
      );
    }

    const remark = (body.remark || '').trim() || null;
    const liable = (body.liablePerson || '').trim() || null;
    // 源店名：调拔入库流水要写「XX店调入」，这里先取好
    const sourceStore = await this.prisma.store.findUnique({ where: { id: sid } });
    const sourceStoreName = sourceStore?.name ?? '';

    const result = await this.prisma.retryOnBusy(() =>
      this.prisma.$transaction(async (tx) => {
        // 事务内二次校验库存，避免并发下出库超卖
        const cur = await tx.stock.findUnique({
          where: { storeId_productId: { storeId: sid, productId: product!.id } },
        });
        if (!cur || cur.quantity < qty) {
          throw new BadRequestException(
            `库存不足：当前仅剩 ${cur?.quantity ?? 0} 件，无法出库 ${qty} 件`,
          );
        }

        const salePrice = round2(cur.salePrice);
        const unitCost = round2(cur.avgCost);

        // 调拔需要读目标门店库存来算加权均价
        let target: { id: number; name: string } | null = null;
        let targetStock: { quantity: number; avgCost: number } | null = null;
        if (outType === 'TRANSFER') {
          target = await tx.store.findUnique({ where: { id: Number(body.targetStoreId) } });
          if (!target) throw new BadRequestException('调入门店不存在');
          targetStock = await tx.stock.findUnique({
            where: {
              storeId_productId: {
                storeId: target.id,
                productId: product!.id,
              },
            },
          });
        }

        /**
         * 账务口径（三种方式完全不同）：
         *
         * LOSS 丢失/破损：**不记成本**（costPrice/totalCost 都记 0），
         *   改记「赔偿金额」= 售价 × 件数。理由：员工照价赔，用售价计赔；
         *   而且这条记录是员工能看到的，写成本等于把进货价暴露给所有人。
         *
         * SUPPLIER 退供应商：成本清零，没有经济损失，不记成本也不记赔偿。
         *
         * TRANSFER 调拔：成本随货走（源店记结转成本，目标店按同价入库），
         *   这是公司内部流转，成本不出体系，不需要赔偿金额。
         */
        const isLoss = outType === 'LOSS';
        const isSupplier = outType === 'SUPPLIER';
        const isTransfer = outType === 'TRANSFER';
        const bookCost = isLoss || isSupplier ? 0 : unitCost;
        const totalCost = lineAmount(bookCost, qty);
        // 赔偿金额按售价算（照价赔）
        const compensate = isLoss ? lineAmount(salePrice, qty) : 0;

        // 1) 源店库存减少
        await tx.stock.update({
          where: { id: cur.id },
          data: { quantity: { decrement: qty } },
        });

        // 2) 源店出库流水
        await tx.stockBatch.create({
          data: {
            storeId: sid,
            productId: product!.id,
            costPrice: bookCost,
            salePrice,
            quantity: qty,
            direction: 'OUT',
            type: outType,
            totalCost,
            compensate,
            relatedStoreId: target?.id ?? null,
            relatedStoreName: target?.name ?? null,
            liablePerson: liable,
            operatorId: user.id,
            remark,
          },
        });

        // 3) 调拔：目标店加库存 + 生成一条「调拔」入库流水
        if (outType === 'TRANSFER' && target) {
          const tQty = targetStock?.quantity ?? 0;
          const tCost = targetStock?.avgCost ?? 0;
          // 目标店的移动加权均价
          const newAvg = tQty > 0 ? round2((tCost * tQty + unitCost * qty) / (tQty + qty)) : unitCost;
          await tx.stock.upsert({
            where: {
              storeId_productId: { storeId: target.id, productId: product!.id },
            },
            create: {
              storeId: target.id,
              productId: product!.id,
              quantity: qty,
              avgCost: unitCost,
              salePrice,
            },
            update: {
              quantity: { increment: qty },
              avgCost: newAvg,
              salePrice,
            },
          });
          await tx.stockBatch.create({
            data: {
              storeId: target.id,
              productId: product!.id,
              costPrice: unitCost,
              salePrice,
              quantity: qty,
              direction: 'IN',
              type: 'TRANSFER',
              totalCost: lineAmount(unitCost, qty),
              relatedStoreId: sid,
              // 来源说明：XX店调入
              relatedStoreName: sourceStoreName,
              operatorId: user.id,
              remark,
            },
          });
        }

        const after = await tx.stock.findUnique({ where: { id: cur.id } });
        return {
          after,
          unitCost,
          totalCost,
          compensate,
          targetStoreName: target?.name ?? null,
        };
      }),
    );

    return {
      success: true,
      product: { id: product.id, sku: product.sku, name: product.name, image: product.image },
      stock: result.after,
      unitCost: result.unitCost,
      totalCost: result.totalCost,
      compensate: result.compensate,
      outType,
      targetStoreName: result.targetStoreName,
    };
  }

  /**
   * 出入库记录（只读）
   * 有 inventory:view 即可查看（店长/营业员默认有），无需出入库操作权限；
   * 进货价按 finance:cost 过滤，没有成本权限的账号拿到的 costPrice 为 null。
   * direction 可选 all/in/out：默认全部，可只看入库或只看出库。
   */
  @Guard(PERM.INVENTORY_VIEW, PERM.INVENTORY_IN, PERM.STOCK_VIEW)
  @Get('records')
  async records(
    @Query('storeId') storeId: string,
    @Query('direction') direction?: string,
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
    // 方向过滤：all（默认）/ in / out
    const dir = (direction || 'all').toLowerCase();
    if (dir === 'in') where.direction = 'IN';
    else if (dir === 'out') where.direction = 'OUT';
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
        totalCost: canSeeCost ? r.totalCost : null,
        // 赔偿金额按售价算，不是成本，人人可见（用来向责任人追偿）
        compensate: r.compensate || 0,
        salePrice: r.salePrice,
        direction: r.direction,
        type: r.type,
        relatedStoreName: r.relatedStoreName,
        liablePerson: r.liablePerson,
        remark: r.remark,
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

    /**
     * 「进价」= 该店该商品最近一次入库的进货价。
     * 从 StockBatch 里按门店+商品取 createdAt 最新的一条入库流水。
     * 用来和「标准成本价」「均价成本」对照，一眼看出历史进货有没有偏离常规。
     */
    const lastInMap = new Map<string, number>();
    if (canSeeCost && rows.length) {
      const keys = rows.map((s) => ({ storeId: s.storeId, productId: s.productId }));
      const batches = await this.prisma.stockBatch.findMany({
        where: {
          direction: 'IN',
          OR: keys,
        },
        select: { storeId: true, productId: true, costPrice: true },
        orderBy: { createdAt: 'desc' },
      });
      for (const b of batches) {
        const k = `${b.storeId}_${b.productId}`;
        if (!lastInMap.has(k)) lastInMap.set(k, round2(b.costPrice));
      }
    }

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
        // 标准成本价：商品档案里预设的常规进货水平（入库时进货价的默认值）
        stdCost: canSeeCost ? round2(s.product.costPrice ?? 0) : null,
        // 进价：该店最近一次入库的进货价
        lastInCost: canSeeCost ? lastInMap.get(`${s.storeId}_${s.productId}`) ?? null : null,
        // 均价成本：移动加权平均，销售结转成本与毛利都用它
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
