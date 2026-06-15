'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { BOOKING_STYLE, type BookingStatus, Button, cn } from '@pms/ui';
import { useT } from '@/lib/i18n';
import { rangeLabel } from '@/lib/calendar/calendar-utils';

/** Trạng thái có occupancy → hiện trên lịch (HOLD/PENDING/CONFIRMED/CHECKED_IN). */
export const CALENDAR_STATUSES: BookingStatus[] = ['HOLD', 'PENDING', 'CONFIRMED', 'CHECKED_IN'];
const RANGE_OPTIONS = [7, 14, 30];

interface Props {
  rangeStart: Date;
  days: number;
  statusFilter: ReadonlySet<string>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDaysChange: (days: number) => void;
  onToggleStatus: (status: BookingStatus) => void;
  onNewBooking: () => void;
}

export function CalendarToolbar({
  rangeStart,
  days,
  statusFilter,
  onPrev,
  onNext,
  onToday,
  onDaysChange,
  onToggleStatus,
  onNewBooking,
}: Props) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label={t('calendar.prev')} onClick={onPrev}>
          <ChevronLeft />
        </Button>
        <span className="min-w-[8.5rem] text-center text-sm font-semibold">{rangeLabel(rangeStart, days)}</span>
        <Button variant="outline" size="icon" aria-label={t('calendar.next')} onClick={onNext}>
          <ChevronRight />
        </Button>
      </div>

      <Button variant="outline" size="sm" onClick={onToday}>
        <CalendarDays /> {t('calendar.today')}
      </Button>

      <select
        aria-label="Số ngày hiển thị"
        value={days}
        onChange={(e) => onDaysChange(Number(e.target.value))}
        className="h-8 cursor-pointer rounded-md border border-border bg-surface px-2 text-sm outline-none"
      >
        {RANGE_OPTIONS.map((d) => (
          <option key={d} value={d}>
            {d} ngày
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1.5">
        {CALENDAR_STATUSES.map((s) => {
          const active = statusFilter.has(s);
          const style = BOOKING_STYLE[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => onToggleStatus(s)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                active ? style.wrap + ' text-foreground' : 'border-border text-muted-foreground opacity-50',
              )}
            >
              <span className={cn('size-1.5 rounded-full', style.dot)} />
              {style.label}
            </button>
          );
        })}
      </div>

      <Button size="sm" className="ml-auto" onClick={onNewBooking}>
        <Plus /> {t('topbar.newBooking')}
      </Button>
    </div>
  );
}
