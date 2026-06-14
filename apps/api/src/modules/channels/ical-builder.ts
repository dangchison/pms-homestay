/**
 * Builder iCal tối giản cho endpoint PUSH (task 5.3) — đối xứng với ical-parser.ts
 * của 5.2, KHÔNG dùng lib ngoài. Sinh VCALENDAR liệt kê khoảng BẬN (busy) của một
 * bookable_resource để OTA (Airbnb/Booking/Agoda) import và chặn lịch.
 *
 * Ràng buộc:
 *  - KHÔNG PII: SUMMARY chỉ "Reserved" (booking) / "Blocked" (room block).
 *  - CRLF + datetime UTC `YYYYMMDDTHHMMSSZ` theo RFC5545.
 *  - UID ổn định theo nguồn (booking/block) để OTA dedup giữa các lần pull.
 *  - ETag tính TỪ dữ liệu busy (uid|start|end|summary) — KHÔNG phụ thuộc dtstamp —
 *    nên 304 hoạt động đúng khi lịch không đổi (dtstamp đổi mỗi request).
 */

import { createHash } from 'node:crypto';

export interface BusyInterval {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
}

const CRLF = '\r\n';

/** Date → 'YYYYMMDDTHHMMSSZ' (UTC, dạng RFC5545). */
export function formatIcalUtc(d: Date): string {
  const p2 = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear().toString().padStart(4, '0')}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`
  );
}

/** Escape ký tự đặc biệt RFC5545 trong TEXT (\\ ; , newline). */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * ETag ổn định theo dữ liệu busy (đã sort) — độc lập thời điểm sinh feed. Cùng
 * danh sách busy → cùng ETag → If-None-Match khớp → 304.
 */
export function computeBusyEtag(intervals: BusyInterval[]): string {
  const canonical = intervals
    .map((iv) => `${iv.uid}|${iv.start.toISOString()}|${iv.end.toISOString()}|${iv.summary}`)
    .join('\n');
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  return `"${hash}"`; // strong validator (có dấu nháy kép theo RFC 7232)
}

/** Sinh VCALENDAR busy. `dtstamp` = thời điểm sinh (không ảnh hưởng ETag). */
export function buildIcal(opts: { calendarName: string; intervals: BusyInterval[]; dtstamp: Date }): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PMS Homestay//Channel Sync 5.3//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
  ];
  const stamp = formatIcalUtc(opts.dtstamp);
  for (const iv of opts.intervals) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${iv.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatIcalUtc(iv.start)}`,
      `DTEND:${formatIcalUtc(iv.end)}`,
      `SUMMARY:${escapeText(iv.summary)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join(CRLF) + CRLF;
}
