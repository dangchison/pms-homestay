/** Tiền VND (đồng nguyên, không phần lẻ). */
export function vnd(n: number): string {
  return n.toLocaleString('vi-VN') + '₫';
}

/** Giá 0: gói FREE là miễn phí, gói trả phí là "liên hệ báo giá". */
export function planPrice(code: string, priceVnd: number): string {
  if (code === 'FREE') return 'Miễn phí';
  return priceVnd > 0 ? `${vnd(priceVnd)}/tháng` : 'Liên hệ';
}

/** ISO → dd/MM/yyyy HH:mm theo giờ VN. */
export function dateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

/** ISO → dd/MM/yyyy. */
export function date(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
