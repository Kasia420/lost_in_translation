/**
 * Number formatting used everywhere on the site (APA-style, as in the README):
 *   p      two significant digits after rounding to 4 decimals, no leading zero: .0015, .015, .53
 *   r      signed, 2 decimals, no leading zero: +.70
 *   values signed, 3 decimals, true minus sign: −.122, +.070
 *   cosine 3 decimals, no leading zero: .810
 */
const MINUS = '−'

const dropZero = (s: string): string => s.replace(/^0\./, '.')

/** Signed value with a real minus sign; values bounded by 1 drop the leading zero. */
export function signed(x: number, digits = 3, leadingZero = false): string {
  const body = Math.abs(x).toFixed(digits)
  const text = leadingZero ? body : dropZero(body)
  if (Number(body) === 0) return text
  return (x < 0 ? MINUS : '+') + text
}

export function unsigned(x: number, digits = 3, leadingZero = false): string {
  const body = x.toFixed(digits)
  return leadingZero ? body : dropZero(body)
}

export function pValue(p: number): string {
  const r4 = Math.round(p * 1e4) / 1e4
  if (r4 === 0) return '< .0001'
  return dropZero(String(Number(r4.toPrecision(2))))
}

/** Axis tick: −1, −0.5, 0, 0.5, 1 with a true minus sign. */
export function tick(x: number): string {
  const s = String(Math.abs(x))
  return x < 0 ? MINUS + s : s
}

export function percent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`
}

export function integer(n: number): string {
  return n.toLocaleString('en-US')
}
