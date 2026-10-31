import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Guard } from '../common/decorators';
import { PERM } from '../common/permissions';
import { CLASS_TITLES } from '../seed/categories.data';

@Controller('categories')
export class CategoriesController {
  constructor(private prisma: PrismaService) {}

  /** 模糊搜索小类（货号/品名联想用）；keyword 为空时返回全部 */
  @Guard(PERM.PRODUCT_VIEW)
  @Get()
  async list(@Query('keyword') keyword?: string) {
    const where: any = {};
    if (keyword && keyword.trim()) {
      const k = keyword.trim();
      where.OR = [
        { name: { contains: k } },
        { groupName: { contains: k } },
        { groupCode: { contains: k } },
      ];
    }
    const rows = await this.prisma.category.findMany({
      where,
      orderBy: [{ niceClass: 'asc' }, { sort: 'asc' }],
      take: keyword ? 200 : undefined,
    });
    return rows.map((c) => ({
      id: c.id,
      niceClass: c.niceClass,
      groupCode: c.groupCode,
      groupName: c.groupName,
      name: c.name,
      label: `${c.name}`,
      groupLabel: `第${c.niceClass}类 · ${c.groupCode} ${c.groupName}`,
    }));
  }

  /** 按大类 -> 类似群 -> 小类 分组，用于级联/分组选择器 */
  @Guard(PERM.PRODUCT_VIEW)
  @Get('grouped')
  async grouped() {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ niceClass: 'asc' }, { sort: 'asc' }],
    });
    const map = new Map<number, Map<string, any>>();
    for (const c of rows) {
      if (!map.has(c.niceClass)) map.set(c.niceClass, new Map());
      const groups = map.get(c.niceClass)!;
      if (!groups.has(c.groupCode)) {
        groups.set(c.groupCode, {
          groupCode: c.groupCode,
          groupName: c.groupName,
          children: [],
        });
      }
      groups.get(c.groupCode)!.children.push({ id: c.id, name: c.name });
    }
    const order = [25, 18, 26, 24, 23];
    return [...map.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([niceClass, groups]) => ({
        niceClass,
        title: CLASS_TITLES[niceClass] || `第${niceClass}类`,
        groups: [...groups.values()],
      }));
  }
}
