import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * StatusBadge + HousekeepingDot (docs/ui/00 §4): màu trạng thái là NGÔN NGỮ
 * CHUNG mọi màn hình (calendar, list, board, PWA) và CỐ Ý bất biến theo theme
 * — màu mang nghĩa, không đổi. Chữ dùng foreground neutral (luôn đủ tương phản
 * mọi theme); màu trạng thái thể hiện qua chấm + viền + nền tint. Chỉ dùng token.
 */

export type BookingStatus =
  | 'HOLD'
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW';

const BOOKING_STYLE: Record<BookingStatus, { label: string; dot: string; wrap: string }> = {
  HOLD: { label: 'Giữ chỗ', dot: 'bg-booking-hold', wrap: 'border-booking-hold/40 bg-booking-hold/12' },
  PENDING: {
    label: 'Chờ cọc',
    dot: 'bg-booking-pending',
    wrap: 'border-booking-pending/40 bg-booking-pending/12',
  },
  CONFIRMED: {
    label: 'Đã xác nhận',
    dot: 'bg-booking-confirmed',
    wrap: 'border-booking-confirmed/40 bg-booking-confirmed/12',
  },
  CHECKED_IN: {
    label: 'Đang ở',
    dot: 'bg-booking-checkedin',
    wrap: 'border-booking-checkedin/40 bg-booking-checkedin/12',
  },
  CHECKED_OUT: { label: 'Đã trả phòng', dot: 'bg-block', wrap: 'border-border bg-muted' },
  CANCELLED: {
    label: 'Đã hủy',
    dot: 'bg-destructive',
    wrap: 'border-destructive/30 bg-destructive-muted',
  },
  NO_SHOW: {
    label: 'No-show',
    dot: 'bg-destructive',
    wrap: 'border-destructive/30 bg-destructive-muted',
  },
};

function BookingStatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  const style = BOOKING_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground',
        style.wrap,
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
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
