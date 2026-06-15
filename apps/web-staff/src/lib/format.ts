/** Định dạng tiền VND (đồng nguyên, không phần lẻ). */
export function vnd(n: number): string {
  return n.toLocaleString('vi-VN') + '₫';
}

/** Giờ HH:mm theo giờ địa phương cơ sở (VN) — dùng trên card hôm nay/check-in. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(d);
}

/** Ngày dd/MM theo giờ VN. */
export function ddmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(d);
}

/** Tên hiển thị 2 chữ cái (avatar). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
