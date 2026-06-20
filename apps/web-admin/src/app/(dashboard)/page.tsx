'use client';

import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SectionHeader,
  Separator,
  StatCard,
  type StatTone,
} from '@pms/ui';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BedDouble,
  Building2,
  CalendarPlus,
  CheckCircle2,
  DoorOpen,
  LogIn,
  LogOut,
  Sparkles,
  Tags,
} from 'lucide-react';
import type { TodayBookingCard } from '@pms/shared-types';
import { vnd } from '@/lib/format';
import { useBookingsCount } from '@/lib/hooks/use-bookings';
import { useInvoices } from '@/lib/hooks/use-invoices';
import { useProperties } from '@/lib/hooks/use-properties';
import { useRatePlans } from '@/lib/hooks/use-rate-plans';
import { useResources } from '@/lib/hooks/use-resources';
import { useRoomsBoard } from '@/lib/hooks/use-rooms-board';
import { useTodayBoard } from '@/lib/hooks/use-today';
import { useUnmatched } from '@/lib/hooks/use-unmatched';
import { usePropertyStore } from '@/stores/property.store';

/**
 * D1 — Dashboard "hôm nay của cả tenant" (docs/ui/01 §D). KPI + đến/đi nối GET
 * /bookings/today; onboarding nối số đếm property/resource/rate-plan/booking
 * (ẩn khi 4/4); cảnh báo nối unmatched/overdue/phòng-bẩn. Realtime qua SSE.
 */

const ONBOARDING = [
  {
    title: 'Tạo cơ sở đầu tiên',
    description: 'Homestay, căn hộ hay rent-to-rent — địa chỉ, múi giờ',
    icon: Building2,
    href: '/properties',
    cta: 'Tạo cơ sở',
  },
  {
    title: 'Thêm phòng & cách bán',
    description: 'Bán từng phòng và/hoặc nguyên căn',
    icon: DoorOpen,
    href: '/properties',
  },
  {
    title: 'Cấu hình gói giá',
    description: 'Theo giờ / ngày / tháng, cuối tuần & lễ',
    icon: Tags,
    href: '/properties',
  },
  {
    title: 'Nhận booking đầu tiên',
    description: 'Tạo trên lịch hoặc đồng bộ từ OTA',
    icon: CalendarPlus,
    href: '/calendar',
  },
] as const;

function todayLabel(): string {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date());
}

export default function DashboardPage() {
  const propertyId = usePropertyStore((s) => s.selectedId);
  const { data: today, isLoading } = useTodayBoard(propertyId);
  const { data: properties } = useProperties();
  const { data: resources } = useResources(propertyId);
  const { data: ratePlans } = useRatePlans(propertyId);
  const { data: bookingsCount } = useBookingsCount(propertyId);
  const { data: unmatched } = useUnmatched();
  const overdueQuery = useInvoices(propertyId, { status: 'OVERDUE' });
  const { data: roomsBoard } = useRoomsBoard(propertyId);

  const arrivals = today?.arrivals ?? [];
  const departures = today?.departures ?? [];
  const inHouse = today?.in_house ?? [];
  const dueToday = [...arrivals, ...departures, ...inHouse].reduce((sum, b) => sum + b.balance_due_vnd, 0);

  const stats: { label: string; value: string | number; icon: typeof LogIn; tone: StatTone; note?: string }[] = [
    { label: 'Khách đến hôm nay', value: arrivals.length, icon: LogIn, tone: 'brand' },
    { label: 'Khách đi hôm nay', value: departures.length, icon: LogOut, tone: 'blue' },
    { label: 'Đang ở', value: inHouse.length, icon: BedDouble, tone: 'violet' },
    {
      label: 'Cần thu hôm nay',
      value: vnd(dueToday),
      icon: Banknote,
      tone: 'amber',
      note: 'Tổng còn nợ từ khách hôm nay',
    },
  ];

  // Onboarding: mỗi bước "xong" khi đã có dữ liệu tương ứng. Ẩn cả thẻ khi đủ 4/4.
  const doneFlags = [
    (properties?.length ?? 0) > 0,
    (resources?.length ?? 0) > 0,
    (ratePlans?.length ?? 0) > 0,
    (bookingsCount ?? 0) > 0,
  ];
  const completed = doneFlags.filter(Boolean).length;

  // Cảnh báo: chỉ hiện mục có nguồn dữ liệu (undefined = chưa tải/không quyền → ẩn).
  const dirtyCount = roomsBoard?.rooms.filter((r) => r.housekeeping_status === 'DIRTY').length;
  const alerts: { label: string; count: number; href: string }[] = [];
  if (unmatched !== undefined)
    alerts.push({ label: 'Giao dịch ngân hàng chưa khớp', count: unmatched.length, href: '/payments/unmatched' });
  if (overdueQuery.data)
    alerts.push({ label: 'Hoá đơn quá hạn', count: overdueQuery.data.page_info.total_items, href: '/invoices' });
  if (dirtyCount !== undefined) alerts.push({ label: 'Phòng cần dọn', count: dirtyCount, href: '/calendar' });
  const hasIssue = alerts.some((a) => a.count > 0);

  return (
    <div className="grid gap-6">
      <SectionHeader
        title={<span className="text-2xl">Tổng quan</span>}
        description={<span className="capitalize">{todayLabel()}</span>}
      />

      {/* KPI row — nối GET /bookings/today */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={isLoading && !today ? '…' : s.value}
            icon={s.icon}
            tone={s.tone}
            note={s.note}
          />
        ))}
      </div>

      {/* Onboarding checklist — ẩn khi đã đủ 4/4 */}
      {completed < 4 && (
        <Card elevation="raised" className="overflow-hidden">
          <div className="bg-primary-muted">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="size-4 text-primary" />
                    Bắt đầu với PMS Homestay
                  </CardTitle>
                  <CardDescription>4 bước để nhận booking đầu tiên</CardDescription>
                </div>
                <Badge variant="secondary">{completed}/4 hoàn thành</Badge>
              </div>
            </CardHeader>
          </div>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 xl:grid-cols-4">
            {ONBOARDING.map(({ title, description, icon: Icon, href, ...rest }, index) => {
              const done = doneFlags[index];
              return (
                <Link
                  key={title}
                  href={href}
                  className="group flex flex-col rounded-xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={
                        done
                          ? 'flex size-9 items-center justify-center rounded-lg bg-success-muted text-success'
                          : 'flex size-9 items-center justify-center rounded-lg bg-chip-brand-soft text-chip-brand'
                      }
                    >
                      {done ? <CheckCircle2 className="size-4.5" /> : <Icon className="size-4.5" />}
                    </span>
                    <span className="text-xs font-medium text-subtle-foreground">
                      {done ? 'Xong' : `Bước ${index + 1}`}
                    </span>
                  </div>
                  <div className="mt-3 text-sm font-medium leading-snug">{title}</div>
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
                  {!done && 'cta' in rest && (
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                      {rest.cta as string}
                      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  )}
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Arrivals / Departures — nối GET /bookings/today */}
        <Card elevation="low" className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Khách đến & đi hôm nay</CardTitle>
            <CardDescription>Bấm vào khách để mở booking — cập nhật realtime (SSE)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              {(
                [
                  { title: 'Khách đến', icon: LogIn, list: arrivals, hint: 'Chưa có lượt check-in nào hôm nay' },
                  { title: 'Khách đi', icon: LogOut, list: departures, hint: 'Chưa có lượt check-out nào hôm nay' },
                ] as const
              ).map(({ title, icon: Icon, list, hint }) => (
                <div key={title}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="size-4 text-primary" />
                      {title}
                    </div>
                    <Badge variant="secondary">{list.length}</Badge>
                  </div>
                  <Separator className="my-3" />
                  {list.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-8 text-center">
                      <Icon className="size-5 text-subtle-foreground" />
                      <p className="max-w-[220px] text-xs text-muted-foreground">{hint}</p>
                    </div>
                  ) : (
                    <ul className="grid gap-2">
                      {list.map((b) => (
                        <BookingRow key={b.id} booking={b} />
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link href="/calendar">
                  Mở lịch phòng
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Cảnh báo vận hành — nối unmatched / overdue / phòng bẩn */}
        <Card elevation="low">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" />
              Cần chú ý
            </CardTitle>
            <CardDescription>Đối soát, quá hạn, dọn phòng</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2.5">
            {alerts.map(({ label, count, href }) => (
              <Link
                key={label}
                href={href}
                className={
                  count > 0
                    ? 'flex items-center justify-between rounded-lg border border-warning/40 bg-warning-muted px-3 py-2.5 transition-colors hover:border-warning'
                    : 'flex items-center justify-between rounded-lg border border-border bg-surface-muted px-3 py-2.5 transition-colors hover:border-primary/40'
                }
              >
                <span className="text-sm">{label}</span>
                {count > 0 ? (
                  <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                    {count}
                  </span>
                ) : (
                  <CheckCircle2 className="size-4 text-success" />
                )}
              </Link>
            ))}
            {alerts.length > 0 && !hasIssue && (
              <div className="mt-1 rounded-lg bg-success-muted px-3 py-2.5 text-xs text-muted-foreground">
                Mọi thứ ổn — không có cảnh báo nào cần xử lý.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Một dòng khách đến/đi — link mở booking, hiện phòng + còn nợ (nếu có). */
function BookingRow({ booking }: { booking: TodayBookingCard }) {
  return (
    <li>
      <Link
        href={`/bookings/${booking.id}`}
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-surface-muted"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{booking.guest_name ?? 'Khách lẻ'}</div>
          <div className="truncate text-xs text-muted-foreground">
            {booking.resource_name} · {booking.booking_code}
          </div>
        </div>
        {booking.balance_due_vnd > 0 && (
          <Badge variant="secondary" className="shrink-0">
            Nợ {vnd(booking.balance_due_vnd)}
          </Badge>
        )}
      </Link>
    </li>
  );
}
