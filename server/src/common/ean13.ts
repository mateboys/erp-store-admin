/**
 * EAN-13 条码工具
 *
 * 规范要点：
 * - 共 13 位数字，最后一位是校验位
 * - 前 12 位按「1、3、1、3…」加权求和，校验位 = (10 - 和 % 10) % 10
 * - 前缀 20~29 是 GS1 保留给「店内码 / 受限流通码（RCN）」的区间，
 *   商家可自行编号，不会与外部厂商的商品条码冲突，适合本系统内部使用
 */

/** 店内码前缀：20 开头，后跟 10 位随机数字，共 12 位，再补 1 位校验位 */
const IN_STORE_PREFIX = '20';

/** 计算 EAN-13 校验位（入参为前 12 位） */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(first12[i]);
    // 第 1、3、5… 位（索引 0、2、4…）权重为 1，其余权重为 3
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** 由前 12 位补全成完整 13 位 EAN-13 */
export function withCheckDigit(first12: string): string {
  return first12 + ean13CheckDigit(first12);
}

/** 随机生成一个 13 位店内码（符合 EAN-13 规范） */
export function randomEan13(): string {
  let body = IN_STORE_PREFIX;
  for (let i = 0; i < 10; i++) body += Math.floor(Math.random() * 10);
  return withCheckDigit(body);
}

/** 合法性校验：13 位纯数字且校验位正确 */
export function isValidEan13(code: any): boolean {
  if (typeof code !== 'string') return false;
  const v = code.trim();
  if (!/^\d{13}$/.test(v)) return false;
  return Number(v[12]) === ean13CheckDigit(v.slice(0, 12));
}
