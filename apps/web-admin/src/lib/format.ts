/** Định dạng tiền VND (đồng nguyên, không phần lẻ). */
export function vnd(n: number): string {
  return n.toLocaleString('vi-VN') + '₫';
}
