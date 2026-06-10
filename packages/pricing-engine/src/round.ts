/**
 * roundVnd() — hàm làm tròn tiền VND DUY NHẤT toàn hệ thống (docs/01 §4, docs/13 §6).
 *
 * Quy tắc: làm tròn half-away-from-zero về đơn vị đồng (VND không có đơn vị lẻ).
 *   1.5 → 2 · 1.4 → 1 · -1.5 → -2
 *
 * KHÔNG dùng Math.round trực tiếp ở nơi khác — Math.round(-1.5) === -1 (round
 * toward +Infinity) sẽ lệch 1 đồng với số âm (refund/điều chỉnh).
 */
export function roundVnd(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new TypeError(`roundVnd: amount phải là số hữu hạn, nhận được ${amount}`);
  }
  const rounded = Math.sign(amount) * Math.round(Math.abs(amount));
  // chuẩn hoá -0 → 0
  return rounded === 0 ? 0 : rounded;
}
