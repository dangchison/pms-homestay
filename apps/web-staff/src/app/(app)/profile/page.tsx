'use client';

import { Button, Card, CardContent, Separator, cn, toast } from '@pms/ui';
import { KeyRound, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOfflineCache';

/**
 * T8 /profile (docs/ui/02): thông tin cá nhân, đổi password, đăng xuất,
 * trạng thái kết nối. Nối auth thật ở task 6.6.
 */
export default function ProfilePage() {
  const online = useOnlineStatus();

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Cá nhân</h1>
      </header>

      <Card>
        <CardContent className="flex items-center gap-4 py-5">
          <span className="flex size-12 items-center justify-center rounded-full bg-teal-100 text-base font-semibold text-teal-700">
            NV
          </span>
          <div className="min-w-0">
            <div className="font-medium">Nhân viên Demo</div>
            <div className="text-sm text-muted-foreground">STAFF · Demo Homestay Đà Nẵng</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-1 py-3">
          <div className="flex min-h-11 items-center justify-between">
            <span className="text-sm">Kết nối</span>
            <span
              className={cn(
                'flex items-center gap-1.5 text-sm font-medium',
                online ? 'text-success' : 'text-destructive',
              )}
            >
              {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
              {online ? 'Online' : 'Offline — chỉ xem'}
            </span>
          </div>
          <Separator />
          <button
            type="button"
            onClick={() => toast.info('Đổi mật khẩu nối API ở task 6.6')}
            className="flex min-h-11 items-center gap-2.5 text-left text-sm transition-colors hover:text-primary"
          >
            <KeyRound className="size-4 text-muted-foreground" />
            Đổi mật khẩu
          </button>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="h-11 w-full text-destructive hover:bg-destructive/5 hover:text-destructive"
        onClick={() => toast.info('Đăng xuất nối API ở task 6.6 — backend /auth/logout đã sẵn')}
      >
        <LogOut className="size-4" />
        Đăng xuất
      </Button>

      <p className="text-center text-xs text-muted-foreground/60">PMS Staff · v0.1 scaffold</p>
    </div>
  );
}
