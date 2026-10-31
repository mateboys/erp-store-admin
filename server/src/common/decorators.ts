import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from './guards/permissions.guard';
import { CurrentUser } from './user.decorator';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMS_KEY = 'perms';
export const RequirePerm = (...perms: string[]) => SetMetadata(PERMS_KEY, perms);

/** 需要登录 */
export function Auth() {
  return applyDecorators(UseGuards(AuthGuard('jwt')));
}

/** 需要登录 + 指定权限 */
export function Guard(...perms: string[]) {
  if (!perms.length) {
    return applyDecorators(UseGuards(AuthGuard('jwt'), PermissionsGuard));
  }
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), PermissionsGuard),
    SetMetadata(PERMS_KEY, perms),
  );
}

export { CurrentUser };
