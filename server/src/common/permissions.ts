/**
 * 权限点定义
 * 角色默认权限 + 账号额外授权（User.permissions）叠加生效
 */
export const PERM = {
  DASHBOARD: 'dashboard:view',
  COST: 'finance:cost', // 查看成本/毛利
  PRODUCT_VIEW: 'product:view',
  PRODUCT_CREATE: 'product:create',
  STOCK_VIEW: 'stock:view',
  INVENTORY_IN: 'inventory:in', // 货品出入库（入库 + 出库：丢失破损/退供应商/调拔）
  INVENTORY_VIEW: 'inventory:view', // 查看出入库记录（只读，不含操作）
  SALE_CREATE: 'sale:create',
  SALE_VIEW: 'sale:view',
  SALE_EDIT: 'sale:edit', // 修改销售单（默认只能改自己开的）
  SALE_EDIT_ALL: 'sale:edit:all', // 修改他人的销售单（需管理员单独授权）
  RETURN_HANDLE: 'return:handle', // 退货处理
  RETURN_VIEW: 'return:view', // 查看退货记录
  STORE_MANAGE: 'store:manage',
  USER_MANAGE: 'user:manage',
};

export const ALL_PERMS = Object.values(PERM);

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  // 管理员：全部权限
  ADMIN: [...ALL_PERMS],
  // 店长：总览(不含成本)、商品查看(只读)、库存查看、销售记账
  // 商品档案由管理员统一维护，店长默认不能新增/编辑/删除商品，
  // 需要时可在「账号权限」页单独勾选「新增/编辑商品」追加授权
  // 出入库操作（inventory:in）默认不开放，需要时单独授权
  MANAGER: [
    PERM.DASHBOARD,
    PERM.PRODUCT_VIEW,
    PERM.STOCK_VIEW,
    PERM.INVENTORY_VIEW,
    PERM.SALE_CREATE,
    PERM.SALE_VIEW,
    PERM.SALE_EDIT,
    PERM.RETURN_HANDLE,
    PERM.RETURN_VIEW,
  ],
  // 营业员：暂与店长一致
  CLERK: [
    PERM.DASHBOARD,
    PERM.PRODUCT_VIEW,
    PERM.STOCK_VIEW,
    PERM.INVENTORY_VIEW,
    PERM.SALE_CREATE,
    PERM.SALE_VIEW,
    PERM.SALE_EDIT,
    PERM.RETURN_HANDLE,
    PERM.RETURN_VIEW,
  ],
};

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: '管理员',
  MANAGER: '店长',
  CLERK: '营业员',
};

/** 角色默认权限 + 额外授权 */
export function effectivePermissions(role: string, extra: string | null | undefined): string[] {
  if (role === 'ADMIN') return [...ALL_PERMS];
  let extraList: string[] = [];
  try {
    if (extra) extraList = JSON.parse(extra);
    if (!Array.isArray(extraList)) extraList = [];
  } catch {
    extraList = [];
  }
  return Array.from(new Set([...(ROLE_PERMISSIONS[role] || []), ...extraList]));
}

/** 该角色可被单独追加授权的扩展权限项（不含角色默认已有项） */
export function grantablePermissions(role: string): string[] {
  if (role === 'ADMIN') return [];
  const base = ROLE_PERMISSIONS[role] || [];
  return ALL_PERMS.filter((p) => !base.includes(p));
}
