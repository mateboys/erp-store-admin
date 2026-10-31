import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './common/prisma.service';
import { AuthModule } from './auth/auth.module';
import { AuthController } from './auth/auth.controller';
import { StoresController } from './stores/stores.controller';
import { UsersController } from './users/users.controller';
import { CategoriesController } from './categories/categories.controller';
import { ProductsController } from './products/products.controller';
import { InventoryController } from './inventory/inventory.controller';
import { SalesController } from './sales/sales.controller';
import { ReturnsController } from './returns/returns.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { SeedService } from './seed/seed.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule],
  controllers: [
    AuthController,
    StoresController,
    UsersController,
    CategoriesController,
    ProductsController,
    InventoryController,
    SalesController,
    ReturnsController,
    DashboardController,
  ],
  providers: [PrismaService, SeedService],
})
export class AppModule {}
