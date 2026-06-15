/**
 * Cầu nối ISO (UTC, BE) ↔ `<input type="datetime-local">` (giờ trình duyệt).
 * Round-trip nhất quán trong cùng timezone trình duyệt (đủ cho MVP — lễ tân nhập
 * theo giờ địa phương cơ sở).
 */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function localInputToIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
