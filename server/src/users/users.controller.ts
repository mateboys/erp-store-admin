import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.service';
import { Guard, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/user.decorator';
import { PERM, ROLE_LABEL, ROLE_PERMISSIONS, ALL_PERMS, grantablePermissions } from '../common/permissions';
import { resolvePaging, paging } from '../common/paging';

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Guard(PERM.USER_MANAGE)
  @Get()
  async list(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const where: any = {};
    if (keyword) {
      where.OR = [{ username: { contains: keyword } }, { name: { contains: keyword } }];
    }
    const { skip, take, page: p, pageSize: size } = resolvePaging(page, pageSize);
    const total = await this.prisma.user.count({ where });
    const users = await this.prisma.user.findMany({
      where,
      include: { store: true },
      orderBy: { id: 'asc' },
      skip,
      take,
    });
    return paging(
      total,
      p,
      size,
      users.map((u) => this.sanitize(u)),
    );
  }

  /** 权限元数据：角色默认权限、可追加授权项 */
  @Guard(PERM.USER_MANAGE)
  @Get('meta')
  meta() {
    return {
      roles: Object.keys(ROLE_PERMISSIONS).map((k) => ({ value: k, label: ROLE_LABEL[k] })),
      allPerms: ALL_PERMS,
      rolePermissions: ROLE_PERMISSIONS,
      grantable: {
        ADMIN: grantablePermissions('ADMIN'),
        MANAGER: grantablePermissions('MANAGER'),
        CLERK: grantablePermissions('CLERK'),
      },
    };
  }

  @Guard(PERM.USER_MANAGE)
  @Post()
  async create(
    @Body()
    body: {
      username: string;
      password: string;
      name: string;
      role: string;
      storeId?: number | null;
      permissions?: string[];
    },
  ) {
    if (!body.username || !body.password) throw new BadRequestException('账号和密码不能为空');
    const exist = await this.prisma.user.findUnique({ where: { username: body.username } });
    if (exist) throw new BadRequestException('该账号已存在');
    if (body.role !== 'ADMIN' && !body.storeId) throw new BadRequestException('店长/营业员必须指定所属门店');
    const user = await this.prisma.user.create({
      data: {
        username: body.username,
        password: await bcrypt.hash(body.password, 10),
        name: body.name || body.username,
        role: body.role || 'CLERK',
        storeId: body.role === 'ADMIN' ? null : body.storeId,
        permissions: JSON.stringify(body.permissions || []),
      },
      include: { store: true },
    });
    return this.sanitize(user);
  }

  @Guard(PERM.USER_MANAGE)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      role?: string;
      storeId?: number | null;
      permissions?: string[];
      status?: string;
      password?: string;
    },
  ) {
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.role !== undefined) {
      data.role = body.role;
      if (body.role === 'ADMIN') data.storeId = null;
    }
    if (body.storeId !== undefined && body.role !== 'ADMIN') data.storeId = body.storeId;
    if (body.permissions !== undefined) data.permissions = JSON.stringify(body.permissions);
    if (body.status !== undefined) data.status = body.status;
    if (body.password) data.password = await bcrypt.hash(body.password, 10);
    const user = await this.prisma.user.update({
      where: { id: +id },
      data,
      include: { store: true },
    });
    return this.sanitize(user);
  }

  @Guard(PERM.USER_MANAGE)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() me: AuthUser) {
    if (+id === me.id) throw new BadRequestException('不能删除当前登录账号');
    return this.prisma.user.delete({ where: { id: +id } });
  }

  private sanitize(u: any) {
    let permissions: string[] = [];
    try {
      permissions = JSON.parse(u.permissions || '[]');
    } catch {
      permissions = [];
    }
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      roleLabel: ROLE_LABEL[u.role] || u.role,
      storeId: u.storeId,
      storeName: u.store?.name || null,
      status: u.status,
      permissions,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    };
  }
}
