'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, Input, Label } from '@pms/ui';
import { Download, Home, Loader2, PlayCircle, Smartphone } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { login } from '@/lib/auth';
import { rememberedTenantSlug } from '@/lib/tenant';
import { DEMO_ACCOUNTS, DEMO_MODE, DEMO_PASSWORD, DEMO_TENANT } from '@/lib/demo';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * T1 /login (docs/ui/02): đăng nhập nhân viên — nhớ tenant slug lần trước; gợi ý
 * thêm vào màn hình chính (A2HS). Phiên giữ 30 ngày qua refresh cookie.
 */
export default function StaffLoginPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    setTenant(rememberedTenantSlug());
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(tenant, { email, password });
      router.replace('/today');
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.status === 401
          ? 'Sai email hoặc mật khẩu'
          : 'Đăng nhập thất bại — kiểm tra mã homestay & kết nối',
      );
      setLoading(false);
    }
  };

  const demoLogin = async (demoEmail: string) => {
    setError(null);
    setLoading(true);
    try {
      await login(DEMO_TENANT, { email: demoEmail, password: DEMO_PASSWORD });
      router.replace('/today');
    } catch {
      setError('Không vào được tài khoản demo — kiểm tra kết nối');
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-b from-teal-600 to-teal-700">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-white">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
          <Home className="size-7" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">PMS Staff</h1>
        <p className="text-sm text-teal-50/90">Lễ tân & buồng phòng — nhanh, một tay</p>
      </div>

      <Card className="rounded-b-none rounded-t-3xl border-0 shadow-2xl">
        <CardContent className="mx-auto grid w-full max-w-sm gap-5 px-6 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <form onSubmit={onSubmit} className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="tenant">Mã homestay (tenant)</Label>
              <Input
                id="tenant"
                placeholder="vd: demo"
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                className="h-12 text-base"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="nhanvien@homestay.vn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoCapitalize="none"
                className="h-12 text-base"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Mật khẩu</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 text-base"
                required
              />
            </div>

            {error && <p className="text-sm font-medium text-destructive">{error}</p>}

            <Button type="submit" disabled={loading} className="h-12 w-full text-base">
              {loading ? <Loader2 className="size-5 animate-spin" /> : 'Đăng nhập'}
            </Button>
          </form>

          {DEMO_MODE && (
            <div className="grid gap-2">
              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                <PlayCircle className="size-3.5" /> Dùng thử nhanh
              </p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <Button
                    key={a.email}
                    type="button"
                    variant="outline"
                    disabled={loading}
                    onClick={() => demoLogin(a.email)}
                    className="h-11"
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {installEvt ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={() => void installEvt.prompt()}
            >
              <Download className="size-4" />
              Thêm vào màn hình chính
            </Button>
          ) : (
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Smartphone className="size-3.5" />
              Mẹo: thêm vào màn hình chính để dùng như app
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
