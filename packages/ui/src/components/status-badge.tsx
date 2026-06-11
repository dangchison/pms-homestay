import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * StatusBadge + HousekeepingDot (docs/ui/00 §4): màu trạng thái là NGÔN NGỮ
 * CHUNG của mọi màn hình — map đúng token §3, không tự chế màu.
 */

export type BookingStatus =
  | 'HOLD'
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW';

const BOOKING_STYLE: Record<BookingStatus, { label: string; className: string }> = {
  HOLD: { label: 'Giữ chỗ', className: 'bg-booking-hold/15 text-amber-700 border-booking-hold/40' },
  PENDING: {
    label: 'Chờ cọc',
    className: 'bg-booking-pending/15 text-orange-700 border-booking-pending/40',
  },
  CONFIRMED: {
    label: 'Đã xác nhận',
    className: 'bg-booking-confirmed/15 text-teal-700 border-booking-confirmed/40',
  },
  CHECKED_IN: {
    label: 'Đang ở',
    className: 'bg-booking-checkedin/15 text-blue-700 border-booking-checkedin/40',
  },
  CHECKED_OUT: { label: 'Đã trả phòng', className: 'bg-muted text-muted-foreground border-border' },
  CANCELLED: {
    label: 'Đã hủy',
    className: 'bg-destructive/10 text-destructive border-destructive/30',
  },
  NO_SHOW: { label: 'No-show', className: 'bg-destructive/10 text-destructive border-destructive/30' },
};

function BookingStatusBadge({
  status,
  className,
}: {
  status: BookingStatus;
  className?: string;
}) {
  const style = BOOKING_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}

export type HousekeepingStatus = 'CLEAN' | 'DIRTY' | 'CLEANING' | 'INSPECTION';

const HK_STYLE: Record<HousekeepingStatus, { label: string; dotClass: string }> = {
  CLEAN: { label: 'Sạch', dotClass: 'bg-hk-clean' },
  DIRTY: { label: 'Bẩn', dotClass: 'bg-hk-dirty' },
  CLEANING: { label: 'Đang dọn', dotClass: 'bg-hk-cleaning' },
  INSPECTION: { label: 'Chờ kiểm tra', dotClass: 'bg-hk-inspection' },
};

/** Dot trạng thái buồng phòng — dùng trên calendar, room board, list. */
function HousekeepingDot({
  status,
  showLabel = false,
  className,
}: {
  status: HousekeepingStatus;
  showLabel?: boolean;
  className?: string;
}) {
  const style = HK_STYLE[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)} title={style.label}>
      <span className={cn('size-2.5 shrink-0 rounded-full', style.dotClass)} />
      {showLabel && <span className="text-muted-foreground">{style.label}</span>}
    </span>
  );
}

export { BookingStatusBadge, HousekeepingDot, BOOKING_STYLE, HK_STYLE };
