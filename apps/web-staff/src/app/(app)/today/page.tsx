'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardContent, Skeleton } from '@pms/ui';
import { BedDouble, CalendarCheck, LogIn, LogOut, RefreshCw } from 'lucide-react';
import type { TodayBookingCard } from '@pms/shared-types';
import { useSelectedProperty } from '@/lib/hooks/use-properties';
import { useTodayBoard } from '@/lib/hooks/use-today';
import { useAuthStore } from '@/stores/auth.store';
import { PropertyPicker } from '@/components/PropertyPicker';
import { TodayCard } from '@/components/today/TodayCard';

function todayLabel(): string {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date());
}

const SECTIONS = [
  { key: 'arrivals', title: 'Khách đến', icon: LogIn, tint: 'bg-teal-50 text-teal-600', kind: 'arrival', empty: 'Chưa có lượt check-in hôm nay' },
  { key: 'departures', title: 'Khách đi', icon: LogOut, tint: 'bg-blue-50 text-blue-600', kind: 'departure', empty: 'Chưa có lượt check-out hôm nay' },
  { key: 'in_house', title: 'Đang ở', icon: BedDouble, tint: 'bg-violet-50 text-violet-600', kind: 'in_house', empty: 'Chưa có phòng nào có khách' },
] as const;

export default function TodayPage() {
  const router = useRouter();
  const isHousekeeper = useAuthStore((s) => s.user?.role) === 'HOUSEKEEPER';
  const { selectedId } = useSelectedProperty();
  const { data, isLoading, isFetching, refetch } = useTodayBoard(isHousekeeper ? null : selectedId);

  // Buồng phòng không có quyền xem bảng hôm nay (GET /bookings/today → 403) → về /cleaning.
  useEffect(() => {
    if (isHousekeeper) router.replace('/cleaning');
  }, [isHousekeeper, router]);

  if (isHousekeeper) return null;

  return (
    <div className="grid gap-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Hôm nay</h1>
          <p className="text-sm capitalize text-muted-foreground">{todayLabel()}</p>
          <PropertyPicker />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Làm mới"
          onClick={() => void refetch()}
          className="text-muted-foreground"
        >
          <RefreshCw className={isFetching ? 'size-5 animate-spin' : 'size-5'} />
        </Button>
      </header>

      {SECTIONS.map(({ key, title, icon: Icon, tint, kind, empty }) => {
        const cards = (data?.[key] ?? []) as TodayBookingCard[];
        return (
          <section key={key}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`flex size-7 items-center justify-center rounded-lg ${tint}`}>
                  <Icon className="size-4" />
                </span>
                <h2 className="text-sm font-semibold">{title}</h2>
              </div>
              <Badge variant="secondary">{cards.length}</Badge>
            </div>

            {isLoading ? (
              <Skeleton className="h-20 w-full rounded-xl" />
            ) : cards.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
                  <CalendarCheck className="size-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{empty}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-2">
                {cards.map((c) => (
                  <TodayCard key={c.id} card={c} kind={kind} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <p className="text-center text-xs text-muted-foreground/60">Cập nhật realtime · chạm để làm mới</p>
    </div>
  );
}
