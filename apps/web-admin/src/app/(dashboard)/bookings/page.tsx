'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BookingStatusBadge,
  Button,
  DateRangePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@pms/ui';
import type { BookingStatus } from '@pms/shared-types';
import { vnd } from '@/lib/format';
import { type BookingFilters, useBookingsList } from '@/lib/hooks/use-bookings';
import { useT } from '@/lib/i18n';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';

// 'ALL' = sentinel "mọi giá trị" (Radix Select không nhận value rỗng).
const STATUSES: { value: string; label: string }[] = [
  { value: 'ALL', label: 'Mọi trạng thái' },
  ...(
    ['HOLD', 'PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as BookingStatus[]
  ).map((s) => ({ value: s, label: s })),
];
// Nguồn: filter CLIENT-SIDE trên rows của trang hiện tại — BE /bookings CHƯA nhận param
// source (BookingListQuerySchema chỉ có property_id/status/from/to). Xem chú thích ở render.
const SOURCES = [
  { value: 'ALL', label: 'Mọi nguồn' },
  ...['DIRECT', 'WALK_IN', 'AIRBNB_ICAL', 'BOOKING_ICAL', 'AGODA_ICAL'].map((s) => ({ value: s, label: s })),
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const VN_DATE = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDate = (iso: string) => VN_DATE.format(new Date(iso));

/** Task 1.1 /bookings — danh sách booking theo cơ sở + filter (trạng thái/khoảng ngày/nguồn). */
export default function BookingsPage() {
  const t = useT();
  const router = useRouter();
  const propertyId = usePropertyStore((s) => s.selectedId);
  const [filters, setFilters] = useState<BookingFilters>({ page: 1 });
  // Nguồn tách khỏi filters vì áp client-side (không gửi lên BE).
  const [source, setSource] = useState<string | undefined>(undefined);
  const { data, isLoading, isFetching } = useBookingsList(propertyId, filters);

  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Đặt phòng" />
        <p className="text-sm text-muted-foreground">{t('calendar.selectProperty')}</p>
      </PageContainer>
    );
  }

  const allRows = data?.data ?? [];
  // nguồn: filter client-side, BE /bookings chưa nhận param source (chỉ áp trên trang hiện tại).
  const bookings = source ? allRows.filter((b) => b.source === source) : allRows;
  const pageInfo = data?.page_info;

  return (
    <PageContainer>
      <PageHeader title="Đặt phòng" />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.status ?? 'ALL'}
          onValueChange={(v) => setFilters((f) => ({ ...f, status: v === 'ALL' ? undefined : v, page: 1 }))}
        >
          <SelectTrigger aria-label="Trạng thái" className="h-9 w-[12rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source ?? 'ALL'} onValueChange={(v) => setSource(v === 'ALL' ? undefined : v)}>
          <SelectTrigger aria-label="Nguồn" className="h-9 w-[12rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker
          className="w-[16rem]"
          placeholder="Khoảng ngày nhận"
          value={
            filters.from
              ? { from: new Date(filters.from), to: filters.to ? new Date(filters.to) : undefined }
              : undefined
          }
          onChange={(r) =>
            setFilters((f) => ({
              ...f,
              from: r?.from ? `${ymd(r.from)}T00:00:00.000Z` : undefined,
              to: r?.to ? `${ymd(r.to)}T23:59:59.999Z` : undefined,
              page: 1,
            }))
          }
        />
        {isFetching && <span className="text-xs text-muted-foreground">Đang tải…</span>}
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Mã</th>
                <th className="px-3 py-2 font-medium">Phòng</th>
                <th className="px-3 py-2 font-medium">Khách</th>
                <th className="px-3 py-2 font-medium">Ngày</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 font-medium">Nguồn</th>
                <th className="px-3 py-2 text-right font-medium">Tổng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {bookings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Không có booking.
                  </td>
                </tr>
              ) : (
                bookings.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => router.push(`/bookings/${b.id}`)}
                    className="cursor-pointer hover:bg-accent"
                  >
                    <td className="px-3 py-2 font-medium">{b.booking_code}</td>
                    <td className="px-3 py-2">{b.resource_name ?? '—'}</td>
                    <td className="px-3 py-2">{b.guest_name ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {fmtDate(b.check_in)} → {fmtDate(b.check_out)}
                    </td>
                    <td className="px-3 py-2">
                      <BookingStatusBadge status={b.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{b.source}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{vnd(b.total_amount_vnd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {pageInfo && pageInfo.total_pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={(filters.page ?? 1) <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
          >
            Trước
          </Button>
          <span className="text-muted-foreground">
            {pageInfo.page}/{pageInfo.total_pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={(filters.page ?? 1) >= pageInfo.total_pages}
            onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
          >
            Sau
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
