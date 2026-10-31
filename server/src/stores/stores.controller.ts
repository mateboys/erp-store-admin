import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Guard, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/user.decorator';
import { PERM } from '../common/permissions';
import { paging, resolvePaging } from '../common/paging';

/** Store 表可写字段白名单：前端可能整行回传（含统计字段），必须过滤 */
const EDITABLE_FIELDS = ['name', 'address', 'phone', 'status'] as const;

function pickEditable(body: Record<string, any>) {
  const data: Record<string, any> = {};
  for (const k of EDITABLE_FIELDS) {
    if (body?.[k] !== undefined) data[k] = body[k];
  }
  return data;
}

@Controller('stores')
export class StoresController {
  constructor(private prisma: PrismaService) {}

  /**
   * 当前账号可访问的门店。
   * 管理员只返回营业中的门店（已停用的不出现在切换器 / 入库 / 记账下拉里），
   * 与 auth.service 的登录返回保持一致；停用的店仍可在门店管理页（stats）看到并重新启用。
   * 非管理员固定返回所属门店，不因停用而为空，避免自身门店被停用后页面不可用。
   */
  @Guard(PERM.DASHBOARD, PERM.STORE_MANAGE)
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    if (user.role === 'ADMIN') {
      return this.prisma.store.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      });
    }
    return this.prisma.store.findMany({ where: { id: user.storeId ?? -1 } });
  }

  @Guard(PERM.STORE_MANAGE)
  @Post()
  async create(@Body() body: { name: string; address?: string; phone?: string }) {
    const name = (body?.name || '').trim();
    if (!name) throw new BadRequestException('门店名称不能为空');
    if (await this.prisma.store.findUnique({ where: { name } })) {
      throw new BadRequestException(`门店名称「${name}」已存在`);
    }
    return this.prisma.store.create({
      data: { name, address: body.address, phone: body.phone },
    });
  }

  @Guard(PERM.STORE_MANAGE)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; address?: string; phone?: string; status?: string },
  ) {
    const storeId = +id;
    if (!Number.isInteger(storeId)) throw new BadRequestException('门店 ID 非法');

    const exists = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!exists) throw new NotFoundException('门店不存在');

    const data = pickEditable(body);
    // 编辑时前端会整行回传，这里只保留白名单字段，避免把统计字段写进 Prisma 导致 500
    if (data.name !== undefined) {
      data.name = String(data.name).trim();
      if (!data.name) throw new BadRequestException('门店名称不能为空');
      const dup = await this.prisma.store.findFirst({
        where: { name: data.name, NOT: { id: storeId } },
      });
      if (dup) throw new BadRequestException(`门店名称「${data.name}」已存在`);
    }
    if (data.status !== undefined && !['ACTIVE', 'DISABLED'].includes(data.status)) {
      throw new BadRequestException('门店状态非法');
    }
    if (!Object.keys(data).length) return exists;

    return this.prisma.store.update({ where: { id: storeId }, data });
  }

  @Guard(PERM.STORE_MANAGE)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const storeId = +id;
    const exists = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!exists) throw new NotFoundException('门店不存在');

    const count = await this.prisma.user.count({ where: { storeId } });
    if (count > 0) throw new BadRequestException('该门店下仍有关联账号，无法删除');

    const orderCount = await this.prisma.order.count({ where: { storeId } });
    if (orderCount > 0) {
      throw new BadRequestException(
        `该门店已有 ${orderCount} 笔销售记录，删除会一并清空，请先确认或改为「停用」`,
      );
    }

    await this.prisma.orderItem.deleteMany({ where: { order: { storeId } } });
    await this.prisma.order.deleteMany({ where: { storeId } });
    await this.prisma.stock.deleteMany({ where: { storeId } });
    await this.prisma.stockBatch.deleteMany({ where: { storeId } });
    return this.prisma.store.delete({ where: { id: storeId } });
  }

  /**
   * 门店维度简要统计（分页）。
   * 用 groupBy 一次聚合全部门店，固定 5 条查询（原先是 1 + 3×门店数的 N+1）。
   * 注意：这里返回全部门店（含已停用），管理员才能看到并重新启用。
   */
  @Guard(PERM.STORE_MANAGE)
  @Get('stats')
  async stats(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const { skip, take, page: p, pageSize: size } = resolvePaging(page, pageSize);
    const [stores, total, userGroups, stockGroups, orderGroups] = await Promise.all([
      this.prisma.store.findMany({ orderBy: { id: 'asc' }, skip, take }),
      this.prisma.store.count(),
      this.prisma.user.groupBy({ by: ['storeId'], _count: { _all: true } }),
      this.prisma.stock.groupBy({ by: ['storeId'], _sum: { quantity: true } }),
      this.prisma.order.groupBy({ by: ['storeId'], _sum: { totalAmount: true } }),
    ]);

    const userMap = new Map<number, number>();
    for (const g of userGroups) {
      if (g.storeId != null) userMap.set(g.storeId, g._count._all);
    }
    const stockMap = new Map<number, number>();
    for (const g of stockGroups) {
      if (g.storeId != null) stockMap.set(g.storeId, g._sum.quantity || 0);
    }
    const amountMap = new Map<number, number>();
    for (const g of orderGroups) {
      if (g.storeId != null) amountMap.set(g.storeId, g._sum.totalAmount || 0);
    }

    const rows = stores.map((s) => ({
      ...s,
      userCount: userMap.get(s.id) || 0,
      stockCount: stockMap.get(s.id) || 0,
      totalAmount: amountMap.get(s.id) || 0,
    }));
    return paging(total, p, size, rows);
  }
}
