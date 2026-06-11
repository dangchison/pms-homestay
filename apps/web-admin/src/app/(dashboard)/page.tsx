import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@pms/ui';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BedDouble,
  Building2,
  CalendarPlus,
  CheckCircle2,
  CircleDollarSign,
  DoorOpen,
  LogIn,
  LogOut,
  Sparkles,
  Tags,
} from 'lucide-react';

/**
 * D1 — Dashboard "hôm nay của cả tenant" (docs/ui/01 §D).
 * Scaffold: số liệu 0 + onboarding checklist cho tenant mới; nối
 * GET /dashboard/summary + SSE ở task 6.1/6.5.
 */

const STATS = [
  { label: 'Khách đến hôm nay', value: 0, icon: LogIn, tint: 'bg-teal-50 text-teal-600' },
  { label: 'Khách đi hôm nay', value: 0, icon: LogOut, tint: 'bg-blue-50 text-blue-600' },
  { label: 'Đang ở', value: 0, icon: BedDouble, tint: 'bg-violet-50 text-violet-600' },
  {
    label: 'Doanh thu hôm nay',
    value: '0 ₫',
    icon: Banknote,
    tint: 'bg-amber-50 text-amber-600',
    note: 'OWNER / ACCOUNTANT',
  },
] as const;

const ONBOARDING = [
  {
    title: 'Tạo cơ sở đầu tiên',
    description: 'Homestay, căn hộ hay rent-to-rent — khai báo địa chỉ, múi giờ',
    icon: Building2,
    href: '/properties',
    cta: 'Tạo cơ sở',
  },
  {
    title: 'Thêm phòng & chọn cách bán',
    description: 'Bán từng phòng và/hoặc nguyên căn (bookable unit)',
    icon: DoorOpen,
    href: '/properties',
  },
  {
    title: 'Cấu hình gói giá',
    description: 'Giá theo giờ / ngày / tháng, cuối tuần & ngày lễ',
    icon: Tags,
    href: '/properties',
  },
  {
    title: 'Nhận booking đầu tiên',
    description: 'Tạo trên calendar hoặc đồng bộ từ Airbnb/Booking',
    icon: CalendarPlus,
    href: '/calendar',
  },
] as const;

const ALERTS = [
  { label: 'Xung đột lịch từ kênh OTA', ok: true },
  { label: 'Giao dịch ngân hàng chưa khớp', ok: true },
  { label: 'Hoá đơn quá hạn', ok: true },
  { label: 'Phòng bẩn quá 4 giờ', ok: true },
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
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tổng quan</h1>
        <p className="mt-0.5 text-sm capitalize text-muted-foreground">{todayLabel()}</p>
      </div>

      {/* 4 stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map(({ label, value, icon: Icon, tint, ...rest }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-4 p-5">
              <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tint}`}>
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm text-muted-foreground">{label}</div>
                <div className="text-2xl font-semibold tracking-tight">{value}</div>
                {'note' in rest && (
                  <div className="text-[11px] text-muted-foreground/70">{rest.note}</div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Onboarding checklist cho tenant mới (spec D1) */}
      <Card className="border-primary/20 bg-gradient-to-br from-teal-50/60 to-transparent">
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
        <CardContent className="grid gap-3 pb-5 sm:grid-cols-2 xl:grid-cols-4">
          {ONBOARDING.map(({ title, description, icon: Icon, href, ...rest }, index) => (
            <Link
              key={title}
              href={href}
              className="group flex flex-col rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4.5" />
                </span>
                <span className="text-xs font-medium text-muted-foreground/60">
                  Bước {index + 1}
                </span>
              </div>
              <div className="mt-3 text-sm font-medium leading-snug">{title}</div>
              <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
              {'cta' in rest && (
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  {rest.cta}
                  <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              )}
            </Link>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Arrivals / Departures */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Khách đến & đi hôm nay</CardTitle>
            <CardDescription>Bấm vào khách để mở booking — cập nhật realtime (SSE)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              {(
                [
                  { title: 'Khách đến', icon: LogIn, hint: 'Chưa có lượt check-in nào hôm nay' },
                  { title: 'Khách đi', icon: LogOut, hint: 'Chưa có lượt check-out nào hôm nay' },
                ] as const
              ).map(({ title, icon: Icon, hint }) => (
                <div key={title}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="size-4 text-primary" />
                      {title}
                    </div>
                    <Badge variant="secondary">0</Badge>
                  </div>
                  <Separator className="my-3" />
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center">
                    <Icon className="size-5 text-muted-foreground/50" />
                    <p className="max-w-[220px] text-xs text-muted-foreground">{hint}</p>
                  </div>
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

        {/* Cảnh báo vận hành */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" />
              Cần chú ý
            </CardTitle>
            <CardDescription>Xung đột OTA, đối soát, quá hạn</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2.5">
            {ALERTS.map(({ label, ok }) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg border bg-background px-3 py-2.5"
              >
                <span className="text-sm">{label}</span>
                {ok ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : (
                  <Badge variant="destructive">!</Badge>
                )}
              </div>
            ))}
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
              <CircleDollarSign className="size-4 shrink-0" />
              Mọi thứ ổn — cảnh báo sẽ hiện ở đây khi có dữ liệu vận hành.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
