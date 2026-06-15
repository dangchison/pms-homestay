/** Tiện ích kỳ báo cáo (task 6.5) — tháng `YYYY-MM` ↔ [from,to] ngày (UTC). */

export function currentMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthRange(yyyymm: string): { from: string; to: string } {
  const [y, m] = yyyymm.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // day 0 của tháng kế = ngày cuối tháng này
  return { from: `${yyyymm}-01`, to: `${yyyymm}-${String(last).padStart(2, '0')}` };
}

export function lastNMonths(yyyymm: string, n: number): { label: string; from: string; to: string }[] {
  const [y, m] = yyyymm.split('-').map(Number);
  return Array.from({ length: n }, (_, idx) => {
    const i = n - 1 - idx;
    const d = new Date(Date.UTC(y!, m! - 1 - i, 1));
    const mm = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { label: mm.slice(2), ...monthRange(mm) }; // label 'YY-MM' gọn cho trục X
  });
}
