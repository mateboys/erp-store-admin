/**
 * EAN-13 校验（与后端 server/src/common/ean13.ts 保持一致）
 * 13 位数字，最后一位为校验位；前 12 位按 1、3、1、3… 加权求和
 */

/** 计算校验位（入参为前 12 位） */
export function ean13CheckDigit(first12) {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = Number(first12[i])
    sum += i % 2 === 0 ? d : d * 3
  }
  return (10 - (sum % 10)) % 10
}

/** 合法性：13 位纯数字且校验位正确 */
export function isValidEan13(code) {
  if (typeof code !== 'string') return false
  const v = code.trim()
  if (!/^\d{13}$/.test(v)) return false
  return Number(v[12]) === ean13CheckDigit(v.slice(0, 12))
}
