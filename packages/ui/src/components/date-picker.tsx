'use client';

import { CalendarIcon } from 'lucide-react';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Calendar } from './calendar';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const VN_DATE = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
function fmt(d?: Date): string {
  return d ? VN_DATE.format(d) : '';
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface DatePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Chọn 1 ngày (Popover + Calendar). */
function DatePicker({ value, onChange, placeholder = 'Chọn ngày', disabled, id, className }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('h-9 w-full justify-start text-left font-normal', !value && 'text-muted-foreground', className)}
        >
          <CalendarIcon className="size-4" />
          {value ? fmt(value) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange?.(d);
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Chọn khoảng ngày (from–to) cho bộ lọc báo cáo/audit. */
function DateRangePicker({ value, onChange, placeholder = 'Chọn khoảng ngày', disabled, id, className }: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const label =
    value?.from && value?.to ? `${fmt(value.from)} – ${fmt(value.to)}` : value?.from ? fmt(value.from) : '';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('h-9 w-full justify-start text-left font-normal', !label && 'text-muted-foreground', className)}
        >
          <CalendarIcon className="size-4" />
          {label || <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="range" selected={value} onSelect={onChange} numberOfMonths={2} autoFocus />
      </PopoverContent>
    </Popover>
  );
}

interface DateTimePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  disabled?: boolean;
  id?: string;
  defaultHour?: number;
}

/** Chọn ngày + giờ (Calendar + ô giờ) — cho nhận/trả phòng. */
function DateTimePicker({ value, onChange, disabled, id, defaultHour = 14 }: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const timeStr = value ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : '';

  const setDatePart = (d: Date | undefined) => {
    if (!d) {
      onChange?.(undefined);
      return;
    }
    const next = new Date(d);
    if (value) next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    else next.setHours(defaultHour, 0, 0, 0);
    onChange?.(next);
    setOpen(false);
  };
  const setTimePart = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const base = value ? new Date(value) : new Date();
    base.setHours(h || 0, m || 0, 0, 0);
    onChange?.(base);
  };

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn('h-9 flex-1 justify-start text-left font-normal', !value && 'text-muted-foreground')}
          >
            <CalendarIcon className="size-4" />
            {value ? fmt(value) : <span>Chọn ngày</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={value} onSelect={setDatePart} autoFocus />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        aria-label="Giờ"
        value={timeStr}
        disabled={disabled}
        onChange={(e) => setTimePart(e.target.value)}
        className="w-[7.5rem]"
      />
    </div>
  );
}

export { DatePicker, DateRangePicker, DateTimePicker };
export type { DateRange } from 'react-day-picker';
