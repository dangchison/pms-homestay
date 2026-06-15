'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@pms/shared-types';
import { Button, Input, Label, toast } from '@pms/ui';
import { BedDouble, CalendarDays, Home, PlayCircle, QrCode, RefreshCw } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { ApiClientError } from '@/lib/api-client';
import { login } from '@/lib/auth';
import { DEMO_MODE, DEMO_OWNER } from '@/lib/demo';

const HIGHLIGHTS = [
  { icon: CalendarDays, text: 'Calendar phòng × ngày — kéo thả đổi phòng, chống trùng tuyệt đối' },
  { icon: QrCode, text: 'VietQR động, tự đối soát ngân hàng trong vài giây' },
  { icon: RefreshCw, text: 'Đồng bộ 2 chiều Airbnb / Booking / Agoda' },
  { icon: BedDouble, text: 'Thuê giờ, ngày, tháng — bán từng phòng hoặc nguyên căn' },
] as const;

/**
 * A1 /login (docs/ui/01). Validate bằng CHÍNH schema BE dùng (@pms/shared-types).
 * Gọi API thật khi nối client auth (task 6.1) — backend /auth/login đã sẵn sàng.
 */
export default function LoginPage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(LoginRequestSchema) });

  const [demoLoading, setDemoLoading] = useState(false);

  const onSubmit = async (values: LoginRequest) => {
    try {
      await login(values);
      router.replace('/');
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.message : 'Đăng nhập thất bại — kiểm tra kết nối';
      toast.error(msg);
    }
  };

  const demoLogin = async () => {
    setDemoLoading(true);
    try {
      await login(DEMO_OWNER);
      router.replace('/');
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Đăng nhập demo thất bại — kiểm tra kết nối',
      );
      setDemoLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-600 p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-emerald-300/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <Home className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">PMS Homestay</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight">
            Vận hành homestay nhẹ nhàng như một cuốn lịch
          </h1>
          <p className="mt-3 text-teal-50/90">
            Một nơi cho đặt phòng, dòng tiền, dọn phòng và kênh OTA — xây cho chủ nhà Việt Nam.
          </p>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-teal-50">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-teal-100/70">
          Dùng thử miễn phí 14 ngày · Không cần thẻ
        </p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Home className="size-5" />
            </span>
            <span className="text-lg font-semibold">PMS Homestay</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Đăng nhập</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Trang quản trị dành cho chủ nhà & quản lý
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 grid gap-5" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="ban@homestay.vn"
                className="h-11"
                {...register('email')}
              />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Mật khẩu</Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Quên mật khẩu?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="h-11"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting} className="h-11 w-full text-base">
              Đăng nhập
            </Button>
          </form>

          {DEMO_MODE && (
            <div className="mt-4">
              <Button
                type="button"
                variant="outline"
                disabled={demoLoading}
                onClick={demoLogin}
                className="h-11 w-full text-base"
              >
                <PlayCircle className="size-4" />
                {demoLoading ? 'Đang vào demo…' : 'Dùng thử với tài khoản demo'}
              </Button>
              <p className="mt-1.5 text-center text-xs text-muted-foreground">
                Vào ngay bằng dữ liệu mẫu — không cần đăng ký
              </p>
            </div>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Chưa có tài khoản?{' '}
            <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
              Đăng ký dùng thử 14 ngày
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
