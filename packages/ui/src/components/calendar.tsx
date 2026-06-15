'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { cn } from '../lib/cn';
import { buttonVariants } from './button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Calendar dựa trên react-day-picker v9 (lib mà shadcn Calendar bọc). classNames
 * map sang token Tailwind v4 của @pms/ui; chọn = bg-primary, hôm nay = viền primary,
 * range giữa = accent. Dùng qua DatePicker/DateRangePicker (date-picker.tsx).
 */
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'flex flex-col gap-4',
        month_caption: 'flex h-9 items-center justify-center',
        caption_label: 'text-sm font-medium',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between px-1',
        button_previous: cn(buttonVariants({ variant: 'outline' }), 'size-7 bg-transparent p-0 opacity-60 hover:opacity-100'),
        button_next: cn(buttonVariants({ variant: 'outline' }), 'size-7 bg-transparent p-0 opacity-60 hover:opacity-100'),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-[0.8rem] font-normal text-muted-foreground',
        week: 'mt-2 flex w-full',
        day: 'relative size-9 p-0 text-center text-sm',
        day_button: cn(
          'inline-flex size-9 items-center justify-center rounded-md p-0 text-sm font-normal transition-colors',
          'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:hover:bg-primary',
        ),
        range_start: '[&>button]:rounded-r-none',
        range_end: '[&>button]:rounded-l-none',
        range_middle:
          '[&>button]:rounded-none [&>button]:bg-accent [&>button]:text-accent-foreground [&>button]:aria-selected:bg-accent [&>button]:aria-selected:text-accent-foreground',
        today: '[&>button]:border [&>button]:border-primary',
        outside: '[&>button]:text-muted-foreground/50',
        disabled: '[&>button]:opacity-40',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: cls }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('size-4', cls)} />
          ) : (
            <ChevronRight className={cn('size-4', cls)} />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
