/** 列表分页公共工具：统一 page / pageSize 解析与返回结构 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;

/** 解析分页参数，返回 Prisma 的 skip / take 以及规范化后的页码 */
export function resolvePaging(page?: string, pageSize?: string) {
  const p = Math.max(parseInt(page || '1', 10) || 1, 1);
  const size = Math.min(
    Math.max(parseInt(pageSize || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  return { skip: (p - 1) * size, take: size, page: p, pageSize: size };
}

/** 统一的分页返回结构：{ rows, total, page, pageSize, pageCount } */
export function paging<T>(total: number, page: number, pageSize: number, rows: T[]) {
  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  };
}
