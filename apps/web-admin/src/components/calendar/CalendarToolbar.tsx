'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus } from 'lucide-react';
import {
  BOOKING_STYLE,
  type BookingStatus,
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@pms/ui';
import { useT } from '@/lib/i18n';
import { dayLabel, rangeLabel } from '@/lib/calendar/calendar-utils';

/** Trạng thái có occupancy → hiện trên lịch (HOLD/PENDING/CONFIRMED/CHECKED_IN). */
export const CALENDAR_STATUSES: BookingStatus[] = ['HOLD', 'PENDING', 'CONFIRMED', 'CHECKED_IN'];
const RANGE_OPTIONS = [7, 14, 30];

export type CalendarView = 'day' | 'hour';

interface Props {
  rangeStart: Date;
  days: number;
  view: CalendarView;
  statusFilter: ReadonlySet<string>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDaysChange: (days: number) => void;
  onViewChange: (view: CalendarView) => void;
  onToggleStatus: (status: BookingStatus) => void;
  onNewBooking: () => void;
}

export function CalendarToolbar({
  rangeStart,
  days,
  view,
  statusFilter,
  onPrev,
  onNext,
  onToday,
  onDaysChange,
  onViewChange,
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
        <span className="min-w-[8.5rem] text-center text-sm font-semibold">
          {view === 'hour' ? dayLabel(rangeStart) : rangeLabel(rangeStart, days)}
        </span>
        <Button variant="outline" size="icon" aria-label={t('calendar.next')} onClick={onNext}>
          <ChevronRight />
        </Button>
      </div>

      <Button variant="outline" size="sm" onClick={onToday}>
        <CalendarDays /> {t('calendar.today')}
      </Button>

      {/* Chuyển chế độ Ngày / Giờ (A3) */}
      <div className="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="Chế độ xem">
        <button
          type="button"
          aria-pressed={view === 'day'}
          onClick={() => onViewChange('day')}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            view === 'day' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground',
          )}
        >
          Ngày
        </button>
        <button
          type="button"
          aria-pressed={view === 'hour'}
          onClick={() => onViewChange('hour')}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors',
            view === 'hour' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground',
          )}
        >
          <Clock className="size-3.5" /> Giờ
        </button>
      </div>

      {view === 'day' && (
        <Select value={String(days)} onValueChange={(val) => onDaysChange(Number(val))}>
          <SelectTrigger aria-label="Số ngày hiển thị" className="h-8 w-[7rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d} ngày
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

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
