/** Định dạng tiền VND (đồng nguyên, không phần lẻ). */
export function vnd(n: number): string {
  return n.toLocaleString('vi-VN') + '₫';
}

/**
 * Che SĐT hiển thị (PII — task 1.2): giữ 3 số cuối, phần đầu thay bằng '•'. Số
 * ngắn (≤3 ký tự) → che sạch để không lộ toàn bộ. `null` → '—'.
 */
export function maskPhone(p: string | null): string {
  if (!p) return '—';
  if (p.length <= 3) return '•'.repeat(p.length);
  return '•'.repeat(p.length - 3) + p.slice(-3);
}

/**
 * Che email hiển thị (PII — task 1.2): giữ ký tự đầu local-part + domain nguyên,
 * phần còn lại local-part thay bằng '•••' cố định. Không có '@' hợp lệ → che sạch
 * local-part. `null` → '—'.
 */
export function maskEmail(e: string | null): string {
  if (!e) return '—';
  const at = e.indexOf('@');
  if (at <= 0) return '•'.repeat(Math.max(e.length, 1));
  return `${e[0]}•••${e.slice(at)}`;
}
