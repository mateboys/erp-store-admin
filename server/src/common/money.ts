/**
 * 金额统一精度口径
 *
 * 全系统所有「钱」的计算都必须经过这里，禁止在业务代码里写 toFixed / 裸乘浮点：
 *  - 人民币精确到分（两位小数），结果始终是 number，方便继续参与运算与落库
 *  - 采用「先四舍五入到分，再参与后续计算」的逐笔口径：
 *    明细每一行先取整到分，订单总额 = Σ 已取整的明细金额（不再二次放大浮点误差），
 *    这样前端展示的明细合计、订单总额、退货冲减额三者永远对得上
 *  - 带 1e-9 的误差修正：浮点乘法会把 1.005 存成 1.00499999999999989，
 *    直接 Math.round(x*100) 会错误地把该进位的丢掉（2.675 → 2.67 而不是 2.68）
 *
 * MySQL（DECIMAL）与 SQLite（REAL）都用同一套规则，切换数据源时口径不变。
 */

/** 分的进制 */
export const MONEY_SCALE = 100;

/** 浮点误差修正量（相对金额，远小于 0.005 元，不会影响真实进位判断） */
const EPS = 1e-9;

/** 是否可视为金额（null / 空串 / NaN 一律按 0 处理，避免脏数据把整单算成 NaN） */
function num(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 四舍五入到两位小数（金额通用入口）
 */
export function round2(value: any): number {
  const n = num(value);
  if (n === 0) return 0;
  const biased = n + (n > 0 ? EPS : -EPS);
  return Math.round(biased * MONEY_SCALE) / MONEY_SCALE;
}

/**
 * 单价 × 数量 = 行小计
 * 明细层的每一行金额都先取整到分，再做汇总，保证「Σ明细 === 单据总额」
 */
export function lineAmount(unitPrice: any, quantity: any): number {
  return round2(num(unitPrice) * num(quantity));
}

/** 行毛利 =（成交单价 - 成本单价）× 数量 */
export function lineProfit(unitPrice: any, unitCost: any, quantity: any): number {
  return round2((num(unitPrice) - num(unitCost)) * num(quantity));
}

/** 汇总若干已经取整的金额（最后再取整一次，消除累加误差） */
export function sumAmount(values: any[]): number {
  let total = 0;
  for (const v of values) total += num(v);
  return round2(total);
}

/** 金额相减（退货冲减、优惠差额等） */
export function subAmount(a: any, b: any): number {
  return round2(num(a) - num(b));
}

/** 百分比（毛利率、环比等），默认两位小数；分母为 0 时返回 null 由调用方决定展示 */
export function percent(current: any, previous: any, digits = 2): number | null {
  const p = num(previous);
  if (p === 0) return null;
  const scale = Math.pow(10, digits);
  return Math.round(((num(current) - p) / p) * 100 * scale) / scale;
}
