'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@pms/shared-types';
import { Button, Input, Label, toast } from '@pms/ui';
import { PlayCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { ApiClientError } from '@/lib/api-client';
import { login } from '@/lib/auth';
import { DEMO_MODE, DEMO_OWNER } from '@/lib/demo';

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
    <AuthSplitLayout
      title="Đăng nhập"
      description="Trang quản trị dành cho chủ nhà & quản lý"
      footer={
        <>
          Chưa có tài khoản?{' '}
          <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            Đăng ký dùng thử 14 ngày
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5" noValidate>
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
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
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
    </AuthSplitLayout>
  );
}
