'use client';

import { useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { BOOKING_STYLE, type BookingStatus, cn } from '@pms/ui';
import type { CalendarBooking } from '@pms/shared-types';
import { COL_WIDTH, ROW_HEIGHT, addDays, barRect, dayOffset } from '@/lib/calendar/calendar-utils';

interface Props {
  booking: CalendarBooking;
  rangeStart: Date;
  days: number;
  onClick: (b: CalendarBooking) => void;
  /** Kéo mép → đổi check_in/out (A3 F3 phần 3). Vắng = không cho resize (vd đã check-in). */
  onReschedule?: (booking: CalendarBooking, checkInISO: string, checkOutISO: string) => void;
}

const HANDLE_W = 8; // px — bề rộng tay kéo mép

/** Bar booking trên track (spec #C1): màu theo status (token chung), buffer mờ 2 đầu,
 *  badge "Nguyên căn" cho WHOLE, kéo-thả (dnd-kit) sang resource khác, kéo mép đổi ngày. */
export function BookingBar({ booking, rangeStart, days, onClick, onReschedule }: Props) {
  const style = BOOKING_STYLE[booking.status as BookingStatus];
  const main = barRect(booking.check_in, booking.check_out, rangeStart, days);
  const buf = barRect(booking.occupancy_start, booking.occupancy_end, rangeStart, days);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: booking.id,
    data: { booking },
  });

  // ── Kéo mép (resize) — pointer thuần, tách khỏi dnd-kit (handle là sibling của bar) ──
  const [resizeDelta, setResizeDelta] = useState<{ edge: 'start' | 'end'; days: number } | null>(null);
  const dragRef = useRef<{ edge: 'start' | 'end'; startX: number } | null>(null);

  // Chỉ cho resize mép NẰM TRONG khoảng đang xem (mép bị kẹp ở biên thì ẩn tay kéo).
  const startInView = onReschedule && dayOffset(new Date(booking.check_in), rangeStart) >= 0;
  const endInView = onReschedule && dayOffset(new Date(booking.check_out), rangeStart) <= days;

  function clampDelta(edge: 'start' | 'end', raw: number): number {
    // Giữ tối thiểu 1 ngày: mép trái không vượt (check_out − 1 ngày); mép phải không lùi quá (check_in + 1 ngày).
    const spanDays = Math.round(
      (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / 86_400_000,
    );
    if (edge === 'start') return Math.min(raw, spanDays - 1);
    return Math.max(raw, -(spanDays - 1));
  }

  function startResize(edge: 'start' | 'end', e: React.PointerEvent) {
    if (!onReschedule) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { edge, startX: e.clientX };
    setResizeDelta({ edge, days: 0 });
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = clampDelta(edge, Math.round((ev.clientX - d.startX) / COL_WIDTH));
      setResizeDelta({ edge, days: delta });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setResizeDelta(null);
      if (!d) return;
      const delta = clampDelta(edge, Math.round((ev.clientX - d.startX) / COL_WIDTH));
      if (delta === 0) return;
      if (edge === 'start') {
        const ci = addDays(new Date(booking.check_in), delta).toISOString();
        onReschedule(booking, ci, booking.check_out);
      } else {
        const co = addDays(new Date(booking.check_out), delta).toISOString();
        onReschedule(booking, booking.check_in, co);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Rect xem trước khi đang kéo mép (dashed) — dịch left/width theo delta ngày.
  const preview = resizeDelta
    ? resizeDelta.edge === 'start'
      ? { left: main.left + resizeDelta.days * COL_WIDTH, width: main.width - resizeDelta.days * COL_WIDTH }
      : { left: main.left, width: main.width + resizeDelta.days * COL_WIDTH }
    : null;

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

      {/* Tay kéo mép (sibling của bar → không kích hoạt dnd switch). Ẩn khi đang kéo-thả. */}
      {startInView && !isDragging && (
        <div
          role="separator"
          aria-label="Kéo đổi ngày nhận phòng"
          title="Kéo để đổi ngày nhận"
          onPointerDown={(e) => startResize('start', e)}
          className="absolute top-1/2 z-10 h-[28px] -translate-y-1/2 cursor-ew-resize rounded-l-md hover:bg-foreground/10"
          style={{ left: main.left, width: HANDLE_W }}
        />
      )}
      {endInView && !isDragging && (
        <div
          role="separator"
          aria-label="Kéo đổi ngày trả phòng"
          title="Kéo để đổi ngày trả"
          onPointerDown={(e) => startResize('end', e)}
          className="absolute top-1/2 z-10 h-[28px] -translate-y-1/2 cursor-ew-resize rounded-r-md hover:bg-foreground/10"
          style={{ left: main.left + main.width - HANDLE_W, width: HANDLE_W }}
        />
      )}

      {/* Xem trước khoảng mới khi đang kéo mép */}
      {preview && (
        <div
          className="pointer-events-none absolute top-1/2 z-20 h-[28px] -translate-y-1/2 rounded-md border-2 border-dashed border-primary bg-primary/10"
          style={{ left: preview.left, width: Math.max(COL_WIDTH * 0.5, preview.width) }}
        />
      )}
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
