'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BookingStatus } from '@pms/ui';
import { addDays, startOfUtcDay } from '@/lib/calendar/calendar-utils';
import { useCalendar } from '@/lib/hooks/use-calendar';
import { useT } from '@/lib/i18n';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { type CalendarView as CalendarViewMode, CALENDAR_STATUSES, CalendarToolbar } from '@/components/calendar/CalendarToolbar';
import { CalendarView } from '@/components/calendar/CalendarView';
import { HourlyCalendarView } from '@/components/calendar/HourlyCalendarView';

/** C1 — màn hình lõi: timeline phòng × ngày (docs/ui/01 §C, task 6.2) + chế độ giờ (A3). */
export default function CalendarPage() {
  const t = useT();
  const router = useRouter();
  const propertyId = usePropertyStore((s) => s.selectedId);
  const [now] = useState(() => new Date());
  const [rangeStart, setRangeStart] = useState(() => startOfUtcDay(new Date()));
  const [days, setDays] = useState(14);
  const [view, setView] = useState<CalendarViewMode>('day');
  const [statusFilter, setStatusFilter] = useState<Set<string>>(() => new Set<string>(CALENDAR_STATUSES));

  // Chế độ giờ = 1 ngày (cột theo giờ); chế độ ngày = `days` cột ngày.
  const span = view === 'hour' ? 1 : days;
  const fromISO = useMemo(() => startOfUtcDay(rangeStart).toISOString(), [rangeStart]);
  const toISO = useMemo(() => addDays(startOfUtcDay(rangeStart), span).toISOString(), [rangeStart, span]);

  const { data, isLoading, isError } = useCalendar(propertyId, fromISO, toISO);
  const queryKey = ['occupancy', propertyId ?? '', fromISO, toISO] as const;

  function toggleStatus(s: BookingStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title={t('calendar.title')} />
        <p className="text-sm text-muted-foreground">{t('calendar.selectProperty')}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title={t('calendar.title')} />

      <CalendarToolbar
        rangeStart={rangeStart}
        days={days}
        view={view}
        statusFilter={statusFilter}
        onPrev={() => setRangeStart((d) => addDays(d, -span))}
        onNext={() => setRangeStart((d) => addDays(d, span))}
        onToday={() => setRangeStart(startOfUtcDay(new Date()))}
        onDaysChange={setDays}
        onViewChange={setView}
        onToggleStatus={toggleStatus}
        onNewBooking={() => router.push('/bookings/new')}
      />

      {isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive-muted p-6 text-sm text-foreground">
          Không tải được lịch. Thử lại sau.
        </div>
      ) : view === 'hour' ? (
        <HourlyCalendarView
          data={data}
          isLoading={isLoading}
          day={rangeStart}
          now={now}
          statusFilter={statusFilter}
        />
      ) : (
        <CalendarView
          data={data}
          isLoading={isLoading}
          rangeStart={rangeStart}
          days={days}
          now={now}
          statusFilter={statusFilter}
          queryKey={queryKey}
        />
      )}
    </PageContainer>
  );
}
