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
import { useTodayBoard } from '@/lib/hooks/use-today';
import { usePropertyStore } from '@/stores/property.store';

/**
 * D1 — Dashboard "hôm nay của cả tenant" (docs/ui/01 §D). KPI + danh sách đến/đi
 * nối GET /bookings/today (task 6.6) theo cơ sở đang chọn; realtime qua SSE
 * (`useEvents` invalidate `['today']`). Onboarding + cảnh báo vận hành còn tĩnh.
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
];

const ALERTS = [
  { label: 'Xung đột lịch từ kênh OTA' },
  { label: 'Giao dịch ngân hàng chưa khớp' },
  { label: 'Hoá đơn quá hạn' },
  { label: 'Phòng bẩn quá 4 giờ' },
];

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
  const { data, isLoading } = useTodayBoard(propertyId);

  const arrivals = data?.arrivals ?? [];
  const departures = data?.departures ?? [];
  const inHouse = data?.in_house ?? [];
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
            value={isLoading && !data ? '…' : s.value}
            icon={s.icon}
            tone={s.tone}
            note={s.note}
          />
        ))}
      </div>

      {/* Onboarding checklist (spec D1) — còn tĩnh */}
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
              <Badge variant="secondary">0/4 hoàn thành</Badge>
            </div>
          </CardHeader>
        </div>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 xl:grid-cols-4">
          {ONBOARDING.map(({ title, description, icon: Icon, href, ...rest }, index) => (
            <Link
              key={title}
              href={href}
              className="group flex flex-col rounded-xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-9 items-center justify-center rounded-lg bg-chip-brand-soft text-chip-brand">
                  <Icon className="size-4.5" />
                </span>
                <span className="text-xs font-medium text-subtle-foreground">Bước {index + 1}</span>
              </div>
              <div className="mt-3 text-sm font-medium leading-snug">{title}</div>
              <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
              {'cta' in rest && (
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  {rest.cta as string}
                  <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              )}
            </Link>
          ))}
        </CardContent>
      </Card>

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

        {/* Cảnh báo vận hành — còn tĩnh */}
        <Card elevation="low">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" />
              Cần chú ý
            </CardTitle>
            <CardDescription>Xung đột OTA, đối soát, quá hạn</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2.5">
            {ALERTS.map(({ label }) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-3 py-2.5"
              >
                <span className="text-sm">{label}</span>
                <CheckCircle2 className="size-4 text-success" />
              </div>
            ))}
            <div className="mt-1 rounded-lg bg-success-muted px-3 py-2.5 text-xs text-muted-foreground">
              Mọi thứ ổn — cảnh báo sẽ hiện ở đây khi có dữ liệu vận hành.
            </div>
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
