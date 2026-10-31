import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { PrismaService } from '../common/prisma.service';
import { Guard, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/user.decorator';
import { PERM } from '../common/permissions';
import { randomEan13, isValidEan13 } from '../common/ean13';
import { resolvePaging, paging } from '../common/paging';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

@Controller('products')
export class ProductsController {
  constructor(private prisma: PrismaService) {}

  /** 商品列表；storeId 可选，用于附带该店库存 */
  @Guard(PERM.PRODUCT_VIEW)
  @Get()
  async list(
    @Query('keyword') keyword?: string,
    @Query('categoryId') categoryId?: string,
    @Query('storeId') storeId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const where: any = {};
    if (keyword && keyword.trim()) {
      const k = keyword.trim();
      where.OR = [{ sku: { contains: k } }, { name: { contains: k } }, { barcode: { contains: k } }];
    }
    if (categoryId) where.categoryId = +categoryId;

    const { skip, take, page: p, pageSize: size } = resolvePaging(page, pageSize);
    const total = await this.prisma.product.count({ where });
    const rows = await this.prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: { id: 'desc' },
      skip,
      take,
    });

    let stockMap = new Map<number, any>();
    const ids = rows.map((p) => p.id);
    if (storeId && storeId !== 'all') {
      const stocks = await this.prisma.stock.findMany({
        where: { storeId: +storeId, productId: { in: ids } },
      });
      stocks.forEach((s) => stockMap.set(s.productId, s));
    } else if (storeId === 'all') {
      const agg = await this.prisma.stock.groupBy({
        by: ['productId'],
        where: { productId: { in: ids } },
        _sum: { quantity: true },
      });
      agg.forEach((a: any) => stockMap.set(a.productId, { quantity: a._sum.quantity || 0 }));
    }

    return paging(total, p, size, rows.map((p) => ({
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      image: p.image,
      remark: p.remark,
      status: p.status,
      categoryId: p.categoryId,
      categoryName: p.category ? `${p.category.name}` : null,
      categoryGroup: p.category
        ? `第${p.category.niceClass}类 · ${p.category.groupCode} ${p.category.groupName}`
        : null,
      stock: stockMap.get(p.id)?.quantity ?? null,
      // 档案价（商品管理里维护，入库/销售默认取这两个值）
      salePrice: p.salePrice,
      costPrice: p.costPrice,
      // 该店库存里的现价与移动加权均价，仅作参考
      stockSalePrice: stockMap.get(p.id)?.salePrice ?? null,
      avgCost: stockMap.get(p.id)?.avgCost ?? null,
      createdAt: p.createdAt,
    })));
  }

  /** 货号查重 */
  @Guard(PERM.PRODUCT_VIEW)
  @Get('check-sku')
  async checkSku(@Query('sku') sku?: string, @Query('excludeId') excludeId?: string) {
    if (!sku) return { exists: false };
    const where: any = { sku };
    if (excludeId) where.NOT = { id: +excludeId };
    const found = await this.prisma.product.findFirst({ where });
    return { exists: !!found, product: found ? { id: found.id, sku: found.sku, name: found.name } : null };
  }

  /** 生成一个库内未被占用的 EAN-13 条码（新增商品时预填） */
  @Guard(PERM.PRODUCT_CREATE)
  @Get('next-barcode')
  async nextBarcode() {
    return { barcode: await this.generateBarcode() };
  }

  /** 条码查重 */
  @Guard(PERM.PRODUCT_VIEW)
  @Get('check-barcode')
  async checkBarcode(@Query('barcode') barcode?: string, @Query('excludeId') excludeId?: string) {
    if (!barcode) return { exists: false, valid: false };
    const valid = isValidEan13(barcode);
    const where: any = { barcode };
    if (excludeId) where.NOT = { id: +excludeId };
    const found = valid ? await this.prisma.product.findFirst({ where }) : null;
    return {
      valid,
      exists: !!found,
      product: found ? { id: found.id, sku: found.sku, name: found.name } : null,
    };
  }

  /** 循环生成，直到拿到一个库内不存在的 EAN-13 */
  private async generateBarcode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = randomEan13();
      const exist = await this.prisma.product.findUnique({ where: { barcode: code } });
      if (!exist) return code;
    }
    throw new BadRequestException('条码生成失败，请重试');
  }

  /** 价格字段规范化：undefined=不改；null/空串=清空；其他必须是非负数字 */
  private normalizePrice(v: any, label: string): number | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!isFinite(n) || n < 0) throw new BadRequestException(`${label}必须是不小于 0 的数字`);
    return n;
  }

  /** 校验手工填写的条码格式与占用情况，返回规范化后的值 */
  private async resolveBarcode(input: any, excludeId?: number): Promise<string> {
    const code = String(input ?? '').trim();
    if (!code) return this.generateBarcode();
    if (!isValidEan13(code)) {
      throw new BadRequestException('条码必须是 13 位数字且符合 EAN-13 校验规则');
    }
    const where: any = { barcode: code };
    if (excludeId) where.NOT = { id: excludeId };
    const exist = await this.prisma.product.findFirst({ where });
    if (exist) throw new BadRequestException(`条码 ${code} 已被商品「${exist.name}」占用`);
    return code;
  }

  /** 按货号/条码精确查询（扫码后调用，用于入库/销售） */
  @Guard(PERM.PRODUCT_VIEW)
  @Get('by-sku/:sku')
  async bySku(@Param('sku') sku: string, @Query('storeId') storeId?: string) {
    let p = await this.prisma.product.findUnique({
      where: { sku },
      include: { category: true },
    });
    // 扫进来的也可能是 EAN-13 机读条码
    if (!p && /^\d{13}$/.test(sku)) {
      p = await this.prisma.product.findUnique({
        where: { barcode: sku },
        include: { category: true },
      });
    }
    if (!p) return null;
    let stock: any = null;
    if (storeId && storeId !== 'all') {
      stock = await this.prisma.stock.findUnique({
        where: { storeId_productId: { storeId: +storeId, productId: p.id } },
      });
    }
    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      image: p.image,
      categoryId: p.categoryId,
      categoryName: p.category?.name || null,
      stock: stock?.quantity ?? 0,
      // 档案价优先，没有再退回该店库存里的现价/均价
      salePrice: p.salePrice ?? stock?.salePrice ?? 0,
      costPrice: p.costPrice ?? stock?.avgCost ?? 0,
      avgCost: stock?.avgCost ?? 0,
    };
  }

  @Guard(PERM.PRODUCT_CREATE)
  @Post()
  async create(
    @Body()
    body: {
      sku: string;
      name: string;
      barcode?: string;
      image?: string;
      categoryId?: number;
      costPrice?: number;
      salePrice?: number;
      remark?: string;
    },
  ) {
    if (!body.sku || !body.name) throw new BadRequestException('货号和品名不能为空');
    const exist = await this.prisma.product.findUnique({ where: { sku: body.sku } });
    if (exist) throw new BadRequestException(`货号 ${body.sku} 已存在，请勿重复添加`);
    // 条码留空则自动生成一条库内唯一的 EAN-13
    const barcode = await this.resolveBarcode(body.barcode);
    return this.prisma.product.create({
      data: {
        sku: body.sku.trim(),
        barcode,
        name: body.name.trim(),
        image: body.image || null,
        categoryId: body.categoryId || null,
        // 档案价：销售价供入库/销售直接取用，成本价作为入库时的默认进货价
        costPrice: this.normalizePrice(body.costPrice, '成本价'),
        salePrice: this.normalizePrice(body.salePrice, '销售价'),
        remark: body.remark || null,
      },
    });
  }

  @Guard(PERM.PRODUCT_CREATE)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      sku?: string;
      barcode?: string;
      name?: string;
      image?: string;
      categoryId?: number;
      costPrice?: number;
      salePrice?: number;
      remark?: string;
      status?: string;
    },
  ) {
    const costPrice = this.normalizePrice(body.costPrice, '成本价');
    const salePrice = this.normalizePrice(body.salePrice, '销售价');
    if (costPrice !== undefined) body.costPrice = costPrice as any;
    if (salePrice !== undefined) body.salePrice = salePrice as any;
    if (body.sku) {
      const exist = await this.prisma.product.findFirst({
        where: { sku: body.sku, NOT: { id: +id } },
      });
      if (exist) throw new BadRequestException(`货号 ${body.sku} 已存在`);
    }
    // 条码留空表示不改；传空字符串则重新生成一条
    if (body.barcode !== undefined) {
      body.barcode = await this.resolveBarcode(body.barcode, +id);
    }
    return this.prisma.product.update({ where: { id: +id }, data: body });
  }

  @Guard(PERM.PRODUCT_CREATE)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const used = await this.prisma.stockBatch.count({ where: { productId: +id } });
    if (used > 0) throw new BadRequestException('该商品已有入库记录，不能删除');
    await this.prisma.stock.deleteMany({ where: { productId: +id } });
    return this.prisma.product.delete({ where: { id: +id } });
  }

  /** 商品图片上传 */
  @Guard(PERM.PRODUCT_CREATE)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
          cb(null, name);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  upload(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('未选择文件');
    return { url: `/uploads/${file.filename}` };
  }
}
