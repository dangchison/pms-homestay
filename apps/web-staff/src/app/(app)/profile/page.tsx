'use client';

import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, Separator, cn, toast } from '@pms/ui';
import { KeyRound, LogOut, Radio, Wifi, WifiOff } from 'lucide-react';
import type { UserRole } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';
import { logout } from '@/lib/auth';
import { useRealtimeStore } from '@/lib/hooks/use-events';
import { useSelectedProperty } from '@/lib/hooks/use-properties';
import { useOnlineStatus } from '@/hooks/useOfflineCache';
import { useAuthStore } from '@/stores/auth.store';
import { initials } from '@/lib/format';

const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: 'Chủ nhà',
  MANAGER: 'Quản lý',
  ACCOUNTANT: 'Kế toán',
  STAFF: 'Lễ tân',
  HOUSEKEEPER: 'Buồng phòng',
};

export default function ProfilePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const online = useOnlineStatus();
  const connected = useRealtimeStore((s) => s.connected);
  const { properties, selectedId, current, setSelected } = useSelectedProperty();

  const onChangePassword = async () => {
    if (!user) return;
    await apiClient.post('/auth/forgot-password', { email: user.email }).catch(() => undefined);
    toast.info('Đã gửi email đặt lại mật khẩu (nếu email hợp lệ)');
  };

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Cá nhân</h1>
      </header>

      <Card>
        <CardContent className="flex items-center gap-4 py-5">
          <span className="flex size-12 items-center justify-center rounded-full bg-teal-100 text-base font-semibold text-teal-700">
            {initials(user?.full_name ?? '?')}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{user?.full_name ?? '—'}</div>
            <div className="text-sm text-muted-foreground">
              {user ? ROLE_LABEL[user.role] : ''}
              {current ? ` · ${current.name}` : ''}
            </div>
          </div>
        </CardContent>
      </Card>

      {properties.length > 1 && (
        <Card>
          <CardContent className="grid gap-2 py-3">
            <span className="text-sm font-medium">Cơ sở đang làm</span>
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              className="h-11 rounded-md border border-border bg-card px-3 text-base"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid gap-1 py-3">
          <div className="flex min-h-11 items-center justify-between">
            <span className="text-sm">Mạng</span>
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
          <div className="flex min-h-11 items-center justify-between">
            <span className="text-sm">Realtime (SSE)</span>
            <span className={cn('flex items-center gap-1.5 text-sm font-medium', connected ? 'text-success' : 'text-muted-foreground')}>
              <Radio className="size-4" />
              {connected ? 'Đã kết nối' : 'Chưa kết nối'}
            </span>
          </div>
          <Separator />
          <button
            type="button"
            onClick={onChangePassword}
            className="flex min-h-11 items-center gap-2.5 text-left text-sm transition-colors hover:text-primary"
          >
            <KeyRound className="size-4 text-muted-foreground" />
            Đổi mật khẩu
          </button>
          <Separator />
          <div className="flex min-h-11 items-center justify-between">
            <span className="text-sm">Ngôn ngữ</span>
            <span className="text-sm text-muted-foreground">Tiếng Việt</span>
          </div>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="h-11 w-full text-destructive hover:bg-destructive/5 hover:text-destructive"
        onClick={onLogout}
      >
        <LogOut className="size-4" />
        Đăng xuất
      </Button>

      <p className="text-center text-xs text-muted-foreground/60">PMS Staff · v1.0</p>
    </div>
  );
}
