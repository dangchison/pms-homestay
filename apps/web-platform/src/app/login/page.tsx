'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { type PlatformLoginResponse } from '@pms/shared-types';
import { Button, Card, CardContent, Input, Label } from '@pms/ui';
import { ApiClientError, apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

/** Đăng nhập admin nền tảng — bảng `platform_users`, TÁCH khỏi tài khoản tenant. */
export default function PlatformLoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ data: PlatformLoginResponse }>(
        '/platform/auth/login',
        { email, password },
      );
      setSession(data.access_token, data.admin);
      router.replace('/plans');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Đăng nhập thất bại');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="py-6">
          <h1 className="text-xl font-semibold">Quản trị nền tảng</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tài khoản nền tảng, không phải tài khoản của cơ sở.
          </p>
          <form onSubmit={submit} className="mt-6 grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Mật khẩu</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Phiên chỉ sống trong tab này — tải lại trang sẽ phải đăng nhập lại.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
