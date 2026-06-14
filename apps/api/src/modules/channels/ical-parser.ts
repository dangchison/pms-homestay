/**
 * Parser iCal tối giản cho feed OTA (task 5.2) — KHÔNG dùng lib ngoài (đúng tinh
 * thần pure-function của pricing-engine). Phủ ca thực tế Airbnb/Booking/Agoda:
 *  - all-day `VALUE=DATE` (YYYYMMDD) → midnight theo timezone property.
 *  - datetime UTC `...THHMMSSZ` → instant trực tiếp.
 *  - datetime naive / TZID → coi như wall-clock theo timezone property (xấp xỉ MVP).
 * STATUS:CANCELLED → cancelled. Bỏ qua VEVENT thiếu UID/DTSTART.
 */

export interface IcalEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  cancelled: boolean;
}

interface PropLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Gỡ folding RFC5545: dòng nối tiếp bắt đầu bằng space/tab. */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseLine(line: string): PropLine | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = left.split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: (name ?? '').toUpperCase(), params, value };
}

/** Độ lệch (ms) wall-clock của timeZone so với UTC tại `instant`. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  const asLocalUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asLocalUtc - instant.getTime();
}

/** Wall-clock 'YYYY-MM-DD' + 'HH:MM:SS' theo timeZone → instant UTC thật. */
export function zonedToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const asUtc = new Date(`${dateStr}T${timeStr}Z`); // wall-clock coi như UTC (cùng các trường)
  return new Date(asUtc.getTime() - tzOffsetMs(asUtc, timeZone));
}

/** Giá trị DTSTART/DTEND + params → instant UTC (null nếu không parse được). */
function toDate(value: string, params: Record<string, string>, timeZone: string): Date | null {
  const v = value.trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    if (!/^\d{8}$/.test(v)) return null;
    return zonedToUtc(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, '00:00:00', timeZone);
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return null;
  const [, y, m, d, hh, mm, ss, z] = dt;
  if (z === 'Z') return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
  return zonedToUtc(`${y}-${m}-${d}`, `${hh}:${mm}:${ss}`, timeZone); // naive/TZID → property TZ
}

function isAllDay(value: string, params: Record<string, string>): boolean {
  return params.VALUE === 'DATE' || /^\d{8}$/.test(value.trim());
}

/** Parse toàn bộ VEVENT trong feed iCal → danh sách event (date đã chuẩn hoá UTC). */
export function parseIcal(raw: string, timeZone: string): IcalEvent[] {
  const lines = unfold(raw);
  const events: IcalEvent[] = [];
  let cur: { uid?: string; startRaw?: PropLine; endRaw?: PropLine; summary?: string; cancelled?: boolean } | null =
    null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (cur?.uid && cur.startRaw) {
        const start = toDate(cur.startRaw.value, cur.startRaw.params, timeZone);
        let end = cur.endRaw ? toDate(cur.endRaw.value, cur.endRaw.params, timeZone) : null;
        if (start) {
          // DTEND thiếu (hiếm với all-day) → +1 ngày.
          if (!end) end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
          if (end > start) {
            events.push({
              uid: cur.uid,
              start,
              end,
              summary: cur.summary ?? '',
              cancelled: cur.cancelled ?? false,
            });
          }
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'UID':
        cur.uid = prop.value.trim();
        break;
      case 'DTSTART':
        cur.startRaw = prop;
        break;
      case 'DTEND':
        cur.endRaw = prop;
        break;
      case 'SUMMARY':
        cur.summary = prop.value.trim();
        break;
      case 'STATUS':
        if (prop.value.trim().toUpperCase() === 'CANCELLED') cur.cancelled = true;
        break;
      default:
        break;
    }
  }
  return events;
}

export { isAllDay };
