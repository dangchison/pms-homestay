import { Badge, Card, CardContent } from '@pms/ui';
import { BedDouble, CalendarCheck, LogIn, LogOut } from 'lucide-react';

/**
 * T2 /today — ca làm hôm nay (docs/ui/02): 3 section đến/đi/đang ở,
 * mỗi card: phòng, tên khách, giờ, trạng thái. Nối API + SSE ở task 6.6.
 */

const SECTIONS = [
  {
    title: 'Khách đến',
    icon: LogIn,
    tint: 'bg-teal-50 text-teal-600',
    empty: 'Chưa có lượt check-in hôm nay',
  },
  {
    title: 'Khách đi',
    icon: LogOut,
    tint: 'bg-blue-50 text-blue-600',
    empty: 'Chưa có lượt check-out hôm nay',
  },
  {
    title: 'Đang ở',
    icon: BedDouble,
    tint: 'bg-violet-50 text-violet-600',
    empty: 'Chưa có phòng nào có khách',
  },
] as const;

function todayLabel(): string {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date());
}

export default function TodayPage() {
  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Hôm nay</h1>
        <p className="text-sm capitalize text-muted-foreground">
          {todayLabel()} · Demo Homestay Đà Nẵng
        </p>
      </header>

      {SECTIONS.map(({ title, icon: Icon, tint, empty }) => (
        <section key={title}>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`flex size-7 items-center justify-center rounded-lg ${tint}`}>
                <Icon className="size-4" />
              </span>
              <h2 className="text-sm font-semibold">{title}</h2>
            </div>
            <Badge variant="secondary">0</Badge>
          </div>
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              <CalendarCheck className="size-6 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{empty}</p>
              <p className="text-xs text-muted-foreground/60">
                Danh sách cập nhật realtime khi có booking
              </p>
            </CardContent>
          </Card>
        </section>
      ))}

      <p className="text-center text-xs text-muted-foreground/60">
        Kéo xuống để làm mới · dữ liệu nối ở task 6.6
      </p>
    </div>
  );
}
