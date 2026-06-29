'use client';

import { useMemo, useState } from 'react';
import { BOOKING_STYLE, type BookingStatus, HousekeepingDot, type HousekeepingStatus, cn } from '@pms/ui';
import type {
  CalendarBlock,
  CalendarBooking,
  CalendarOccupancyResponse,
  CalendarResource,
} from '@pms/shared-types';
import {
  HEADER_HEIGHT,
  HOUR_COL_WIDTH,
  HOURS_PER_DAY,
  LABEL_WIDTH,
  ROW_HEIGHT,
  hhmmUtc,
  hourBarRect,
  hourHeaders,
  hourOffset,
  startOfUtcDay,
} from '@/lib/calendar/calendar-utils';
import { BookingDetailDialog } from './BookingDetailDialog';

interface Props {
  data: CalendarOccupancyResponse | undefined;
  isLoading: boolean;
  /** Ngày đang xem (chế độ giờ = 1 ngày). */
  day: Date;
  now: Date;
  statusFilter: ReadonlySet<string>;
}

/**
 * Chế độ GIỜ (A3) — timeline 1 ngày, trục X theo 24 giờ. Booking HOURLY hiển thị
 * đúng khung giờ; booking qua đêm (DAILY…) bị kẹp ở mép ngày. Chỉ-xem: bấm bar mở
 * chi tiết (đặt-nhanh/kéo-mép theo giờ để bản sau). Định vị UTC như lưới ngày.
 */
export function HourlyCalendarView({ data, isLoading, day, now, statusFilter }: Props) {
  const [detail, setDetail] = useState<CalendarBooking | null>(null);

  const resources = data?.resources ?? [];
  const headers = useMemo(() => hourHeaders(day, now), [day, now]);

  const byResource = useMemo(() => {
    const bk = new Map<string, CalendarBooking[]>();
    const bl = new Map<string, CalendarBlock[]>();
    for (const b of data?.bookings ?? []) {
      if (!statusFilter.has(b.status)) continue;
      const arr = bk.get(b.resource_id);
      if (arr) arr.push(b);
      else bk.set(b.resource_id, [b]);
    }
    for (const b of data?.blocks ?? []) {
      const arr = bl.get(b.resource_id);
      if (arr) arr.push(b);
      else bl.set(b.resource_id, [b]);
    }
    return { bk, bl };
  }, [data, statusFilter]);

  const totalWidth = LABEL_WIDTH + HOURS_PER_DAY * HOUR_COL_WIDTH;
  const isToday = startOfUtcDay(day).getTime() === startOfUtcDay(now).getTime();
  const nowLeft = isToday ? hourOffset(now, day) * HOUR_COL_WIDTH : null;

  return (
    <>
      <div
        className="relative overflow-auto rounded-lg border border-border bg-surface"
        style={{ height: 'calc(100vh - 230px)', minHeight: 360 }}
      >
        <div style={{ width: totalWidth, position: 'relative' }}>
          {/* ── Header giờ (frozen trên) ── */}
          <div className="sticky top-0 z-30 flex" style={{ height: HEADER_HEIGHT }}>
            <div
              className="sticky left-0 z-40 flex items-center border-r border-b border-border bg-surface px-3 text-xs font-semibold text-muted-foreground"
              style={{ width: LABEL_WIDTH }}
            >
              Phòng / Nguyên căn
            </div>
            {headers.map((h) => (
              <div
                key={h.hour}
                className={cn(
                  'flex items-center justify-center border-b border-border text-xs',
                  h.isNow && 'bg-primary/10',
                )}
                style={{ width: HOUR_COL_WIDTH }}
              >
                <span className={cn('font-semibold tabular-nums', h.isNow && 'text-primary')}>{h.label}</span>
              </div>
            ))}
          </div>

          {/* ── Body ── */}
          <div className="relative">
            {/* Lớp nền cột giờ + đường "bây giờ" */}
            <div className="pointer-events-none absolute inset-y-0 z-0" style={{ left: LABEL_WIDTH, width: HOURS_PER_DAY * HOUR_COL_WIDTH }}>
              {headers.map((h, i) => (
                <div
                  key={h.hour}
                  className={cn('absolute inset-y-0 border-r border-border/40', h.isNow && 'bg-primary/[0.06]')}
                  style={{ left: i * HOUR_COL_WIDTH, width: HOUR_COL_WIDTH }}
                />
              ))}
              {nowLeft !== null && (
                <div className="absolute inset-y-0 z-10 w-px bg-primary/70" style={{ left: nowLeft }} />
              )}
            </div>

            {!isLoading &&
              resources.map((resource) => (
                <HourlyRow
                  key={resource.id}
                  resource={resource}
                  bookings={byResource.bk.get(resource.id) ?? []}
                  blocks={byResource.bl.get(resource.id) ?? []}
                  day={day}
                  onBookingClick={setDetail}
                />
              ))}
          </div>

          {isLoading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface/60 text-sm text-muted-foreground">
              Đang tải lịch…
            </div>
          )}
          {!isLoading && resources.length === 0 && (
            <div className="absolute inset-0 z-50 flex items-center justify-center text-sm text-muted-foreground">
              Chưa có phòng/nguyên căn cho cơ sở này.
            </div>
          )}
        </div>
      </div>

      <BookingDetailDialog booking={detail} onClose={() => setDetail(null)} />
    </>
  );
}

interface RowProps {
  resource: CalendarResource;
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
  day: Date;
  onBookingClick: (b: CalendarBooking) => void;
}

function HourlyRow({ resource, bookings, blocks, day, onBookingClick }: RowProps) {
  return (
    <div className="flex w-full border-b border-border/60" style={{ height: ROW_HEIGHT }}>
      {/* Nhãn resource (frozen trái) */}
      <div
        className="sticky left-0 z-20 flex items-center gap-2 border-r border-border bg-surface px-3"
        style={{ width: LABEL_WIDTH }}
      >
        {resource.type === 'ROOM' && resource.housekeeping_status && (
          <HousekeepingDot status={resource.housekeeping_status as HousekeepingStatus} />
        )}
        <span className="truncate text-sm font-medium">{resource.name}</span>
        {resource.type === 'WHOLE' && (
          <span className="ml-auto shrink-0 rounded bg-foreground/10 px-1 text-[10px] text-muted-foreground">căn</span>
        )}
      </div>

      {/* Track giờ */}
      <div className="relative" style={{ width: HOURS_PER_DAY * HOUR_COL_WIDTH, height: ROW_HEIGHT }}>
        {blocks.map((bl) => {
          const r = hourBarRect(bl.start_at, bl.end_at, day);
          return (
            <div
              key={bl.id}
              title={`Chặn phòng: ${bl.reason}`}
              className="absolute top-1/2 flex h-[24px] -translate-y-1/2 items-center gap-1 overflow-hidden rounded-md border border-border bg-block/20 px-1.5 text-[11px] text-muted-foreground"
              style={{ left: r.left, width: r.width }}
            >
              <span className="size-1.5 shrink-0 rounded-full bg-block" />
              <span className="truncate">{bl.reason}</span>
            </div>
          );
        })}
        {bookings.map((b) => {
          const style = BOOKING_STYLE[b.status as BookingStatus];
          const r = hourBarRect(b.check_in, b.check_out, day);
          const label = b.guest_name ?? b.booking_code;
          const time = `${hhmmUtc(b.check_in)}–${hhmmUtc(b.check_out)}`;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onBookingClick(b)}
              title={`${time} · ${label} · ${style.label}`}
              className={cn(
                'absolute top-1/2 flex h-[28px] -translate-y-1/2 cursor-pointer items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left text-xs font-medium whitespace-nowrap text-foreground shadow-sm',
                style.wrap,
              )}
              style={{ left: r.left, width: r.width, minWidth: HOUR_COL_WIDTH * 0.4 }}
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
              <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{time}</span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
