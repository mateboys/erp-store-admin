import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../common/prisma.service';
import { effectivePermissions } from '../common/permissions';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'clothing-store-super-secret-2026',
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { store: true },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('账号不存在或已停用');
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      storeId: user.storeId,
      storeName: user.store?.name || null,
      permissions: effectivePermissions(user.role, user.permissions),
    };
  }
}
