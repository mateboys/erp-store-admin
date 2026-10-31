import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.service';
import { effectivePermissions } from '../common/permissions';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { store: true },
    });
    if (!user) throw new UnauthorizedException('账号或密码错误');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('账号或密码错误');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('该账号已被停用');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = this.jwt.sign({ sub: user.id, username: user.username, role: user.role });
    const permissions = effectivePermissions(user.role, user.permissions);

    // 可选门店列表：管理员=全部 + 公司总览；其它=自己所属门店
    const stores =
      user.role === 'ADMIN'
        ? await this.prisma.store.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } })
        : user.storeId
        ? await this.prisma.store.findMany({ where: { id: user.storeId } })
        : [];

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        storeId: user.storeId,
        storeName: user.store?.name || null,
        permissions,
      },
      stores,
    };
  }

  async profile(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { store: true },
    });
    if (!user) throw new UnauthorizedException('账号不存在');
    const stores =
      user.role === 'ADMIN'
        ? await this.prisma.store.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } })
        : user.storeId
        ? await this.prisma.store.findMany({ where: { id: user.storeId } })
        : [];
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      storeId: user.storeId,
      storeName: user.store?.name || null,
      permissions: effectivePermissions(user.role, user.permissions),
      stores,
    };
  }

  async changePassword(id: number, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new UnauthorizedException('账号不存在');
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) throw new UnauthorizedException('原密码不正确');
    await this.prisma.user.update({
      where: { id },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });
    return { success: true };
  }
}
