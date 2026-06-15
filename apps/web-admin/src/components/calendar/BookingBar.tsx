'use client';

import { useDraggable } from '@dnd-kit/core';
import { BOOKING_STYLE, type BookingStatus, cn } from '@pms/ui';
import type { CalendarBooking } from '@pms/shared-types';
import { COL_WIDTH, ROW_HEIGHT, barRect } from '@/lib/calendar/calendar-utils';

interface Props {
  booking: CalendarBooking;
  rangeStart: Date;
  days: number;
  onClick: (b: CalendarBooking) => void;
}

/** Bar booking trên track (spec #C1): màu theo status (token chung), buffer mờ 2 đầu,
 *  badge "Nguyên căn" cho WHOLE, kéo-thả (dnd-kit) sang resource khác. */
export function BookingBar({ booking, rangeStart, days, onClick }: Props) {
  const style = BOOKING_STYLE[booking.status as BookingStatus];
  const main = barRect(booking.check_in, booking.check_out, rangeStart, days);
  const buf = barRect(booking.occupancy_start, booking.occupancy_end, rangeStart, days);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: booking.id,
    data: { booking },
  });

  const label = booking.guest_name ?? booking.booking_code;
  const isOta = booking.source !== 'DIRECT' && booking.source !== 'WALK_IN';

  return (
    <>
      {/* Buffer dọn phòng — mờ, không bắt sự kiện */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-md border border-dashed border-border/60 bg-foreground/[0.04]"
        style={{ left: buf.left, width: buf.width, height: ROW_HEIGHT - 14 }}
      />
      <button
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        type="button"
        onClick={() => onClick(booking)}
        title={`${label} · ${style.label}`}
        className={cn(
          'absolute top-1/2 flex h-[28px] -translate-y-1/2 cursor-grab items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left text-xs font-medium whitespace-nowrap text-foreground shadow-sm transition-opacity active:cursor-grabbing',
          style.wrap,
          isDragging && 'opacity-40',
        )}
        style={{ left: main.left, width: main.width, minWidth: COL_WIDTH * 0.5 }}
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
        {booking.is_whole && (
          <span className="shrink-0 rounded bg-foreground/10 px-1 text-[10px] leading-tight">
            Nguyên căn
          </span>
        )}
        {isOta && (
          <span className="shrink-0 rounded bg-primary/15 px-1 text-[10px] leading-tight text-primary">
            OTA
          </span>
        )}
        <span className="truncate">{label}</span>
      </button>
    </>
  );
}

/** Clone tĩnh cho DragOverlay (theo con trỏ khi kéo). */
export function BookingBarGhost({ booking }: { booking: CalendarBooking }) {
  const style = BOOKING_STYLE[booking.status as BookingStatus];
  return (
    <div
      className={cn(
        'flex h-[28px] items-center gap-1 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap text-foreground shadow-lg',
        style.wrap,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
      <span className="truncate">{booking.guest_name ?? booking.booking_code}</span>
    </div>
  );
}
