import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import { PrismaService } from '../common/prisma.service';
import { CATEGORY_SEED } from './categories.data';
import { randomEan13 } from '../common/ean13';

@Injectable()
export class SeedService implements OnModuleInit {
  private logger = new Logger('Seed');

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedCategories();
    await this.seedStores();
    await this.seedUsers();
    await this.seedDemoData();
  }

  private async seedCategories() {
    const count = await this.prisma.category.count();
    if (count > 0) return;
    await this.prisma.category.createMany({ data: CATEGORY_SEED });
    this.logger.log(`已初始化 ${CATEGORY_SEED.length} 条商品类别（尼斯分类）`);
  }

  private async seedStores() {
    const count = await this.prisma.store.count();
    if (count > 0) return;
    await this.prisma.store.createMany({
      data: [
        { name: '总店·中山路店', address: '中山路 128 号', phone: '0571-8888-0001' },
        { name: '城西银泰店', address: '银泰城 3 楼 B312', phone: '0571-8888-0002' },
        { name: '滨江万象城店', address: '万象城 L2-28', phone: '0571-8888-0003' },
      ],
    });
    this.logger.log('已初始化 3 家门店');
  }

  private async seedUsers() {
    const count = await this.prisma.user.count();
    if (count > 0) return;
    const stores = await this.prisma.store.findMany({ orderBy: { id: 'asc' } });
    const hash = await bcrypt.hash('123456', 10);
    await this.prisma.user.createMany({
      data: [
        { username: 'admin', password: hash, name: '张管理', role: 'ADMIN', storeId: null },
        {
          username: 'manager1',
          password: hash,
          name: '李店长',
          role: 'MANAGER',
          storeId: stores[0]?.id,
        },
        {
          username: 'manager2',
          password: hash,
          name: '王店长',
          role: 'MANAGER',
          storeId: stores[1]?.id,
        },
        {
          username: 'clerk1',
          password: hash,
          name: '赵营业',
          role: 'CLERK',
          storeId: stores[0]?.id,
        },
      ],
    });
    this.logger.log('已初始化账号：admin / manager1 / manager2 / clerk1（密码 123456）');
  }

  /** 演示数据：商品 + 库存 + 近 60 天销售单，便于查看看板效果 */
  private async seedDemoData() {
    const orderCount = await this.prisma.order.count();
    if (orderCount > 0) return;
    const stores = await this.prisma.store.findMany({ orderBy: { id: 'asc' } });
    if (!stores.length) return;
    const cats = await this.prisma.category.findMany({ where: { niceClass: 25 }, take: 12 });

    const demo = [
      ['DY001', '男士直筒牛仔裤', 128, 299],
      ['DY002', '女士高腰阔腿裤', 110, 269],
      ['DY003', '纯棉圆领短袖T恤', 45, 99],
      ['DY004', '韩版宽松连帽卫衣', 95, 239],
      ['DY005', '羊毛混纺圆领毛衣', 168, 399],
      ['DY006', '轻薄羽绒马甲', 180, 459],
      ['DY007', '气质风衣中长款', 260, 699],
      ['DY008', '真丝方巾丝巾', 38, 128],
      ['DY009', '休闲九分休闲裤', 88, 219],
      ['DY010', '百搭针织开衫', 120, 289],
    ];

    const products: any[] = [];
    for (let i = 0; i < demo.length; i++) {
      const [sku, name, cost, sale] = demo[i] as [string, string, number, number];
      const p = await this.prisma.product.create({
        data: {
          sku,
          barcode: randomEan13(),
          name,
          categoryId: cats[i % Math.max(cats.length, 1)]?.id ?? null,
          // 档案价：销售价供入库/销售取用，成本价作为入库时的默认进货价
          costPrice: cost,
          salePrice: sale,
        },
      });
      products.push({ ...p, cost, sale });
    }

    const stocks: any[] = [];
    for (const store of stores) {
      for (const p of products) {
        const qty = 40 + Math.floor(Math.random() * 60);
        // 成本取两位小数，避免均价被浮点拖出 90.70186515925766 这种长小数
        const cost = Math.round((p.cost + (Math.random() * 10 - 5)) * 100) / 100;
        await this.prisma.stockBatch.create({
          data: {
            storeId: store.id,
            productId: p.id,
            costPrice: cost,
            salePrice: p.sale,
            quantity: qty + 120,
            direction: 'IN',
            type: 'MANUAL',
            totalCost: Math.round(cost * (qty + 120) * 100) / 100,
          },
        });
        const s = await this.prisma.stock.create({
          data: {
            storeId: store.id,
            productId: p.id,
            quantity: qty,
            avgCost: cost,
            salePrice: p.sale,
          },
        });
        stocks.push({ ...s, product: p });
      }
    }

    // 近 60 天销售单
    for (let d = 59; d >= 0; d--) {
      const day = dayjs().subtract(d, 'day');
      for (const store of stores) {
        const n = 1 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) {
          const storeStocks = stocks.filter((s) => s.storeId === store.id);
          const pickCount = 1 + Math.floor(Math.random() * 3);
          const picked = Array.from({ length: pickCount }).map(
            () => storeStocks[Math.floor(Math.random() * storeStocks.length)],
          );
          let totalAmount = 0;
          let totalCost = 0;
          let itemCount = 0;
          const items: any[] = [];
          for (const s of picked) {
            const qty = 1 + Math.floor(Math.random() * 2);
            if (s.quantity < qty) continue;
            const amount = s.salePrice * qty;
            totalAmount += amount;
            totalCost += s.avgCost * qty;
            itemCount += qty;
            items.push({
              productId: s.productId,
              sku: s.product.sku,
              name: s.product.name,
              quantity: qty,
              unitPrice: s.salePrice,
              unitCost: s.avgCost,
              subtotal: amount,
              profit: amount - s.avgCost * qty,
            });
            s.quantity -= qty;
          }
          if (!items.length) continue;
          const hour = 9 + Math.floor(Math.random() * 11);
          const createdAt = day.hour(hour).minute(Math.floor(Math.random() * 60)).toDate();
          await this.prisma.order.create({
            data: {
              orderNo: `S${day.format('YYYYMMDD')}${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}${k}`,
              storeId: store.id,
              totalAmount,
              totalCost,
              totalProfit: totalAmount - totalCost,
              itemCount,
              createdAt,
              items: { create: items },
            },
          });
          for (const s of picked) {
            await this.prisma.stock.update({
              where: { id: s.id },
              data: { quantity: s.quantity },
            });
          }
        }
      }
    }
    this.logger.log('已生成演示商品与近 60 天销售数据');
  }
}
