'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@pms/shared-types';
import { Button, Input, Label, toast } from '@pms/ui';
import { PlayCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { ApiClientError } from '@/lib/api-client';
import { login } from '@/lib/auth';
import { DEMO_MODE, DEMO_OWNER, DEMO_TENANT_SLUG } from '@/lib/demo';
import { getSubdomainTenantSlug, getTenantSlug } from '@/lib/tenant';

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

  // Có subdomain thì tenant đã xác định, không hỏi lại. Quyết định sau khi mount
  // vì hostname chỉ có ở trình duyệt — đọc lúc render sẽ lệch hydration với SSR.
  const [askTenant, setAskTenant] = useState(false);
  const [tenantSlug, setTenantSlug] = useState('');
  useEffect(() => {
    if (getSubdomainTenantSlug()) return;
    setAskTenant(true);
    setTenantSlug(getTenantSlug() ?? '');
  }, []);

  const onSubmit = async (values: LoginRequest) => {
    const slug = tenantSlug.trim();
    try {
      await login(values, askTenant && slug ? slug : undefined);
      router.replace('/');
    } catch (err) {
      if (!(err instanceof ApiClientError)) {
        toast.error('Đăng nhập thất bại — kiểm tra kết nối');
        return;
      }
      // 401 ở đây có HAI nguyên nhân không phân biệt được từ phía BE: sai mật khẩu,
      // hoặc đúng mật khẩu nhưng tìm trong nhầm tenant (users unique theo
      // (tenant_id, email)). Nói ra khả năng thứ hai, nếu không người dùng sẽ thử
      // lại đúng mật khẩu đó mãi.
      toast.error(
        err.status === 401 && askTenant
          ? `${err.message} — hoặc không gian làm việc "${slug}" chưa đúng`
          : err.message,
      );
    }
  };

  const demoLogin = async () => {
    setDemoLoading(true);
    try {
      await login(DEMO_OWNER, DEMO_TENANT_SLUG);
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
      {/* method="post": xem ghi chú ở trang đăng ký — tránh mật khẩu rơi vào URL
          khi JS chưa chạy và trình duyệt submit form theo mặc định (GET). */}
      <form onSubmit={handleSubmit(onSubmit)} method="post" className="grid gap-5" noValidate>
        {askTenant && (
          <div className="grid gap-2">
            <Label htmlFor="tenant-slug">Không gian làm việc</Label>
            <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
              <Input
                id="tenant-slug"
                autoComplete="organization"
                placeholder="bien-xanh"
                className="h-11 border-0 focus-visible:ring-0"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
              />
              <span className="shrink-0 px-3 text-sm text-muted-foreground">.pmsapp.vn</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Tên miền riêng bạn đặt khi đăng ký. Truy cập bằng tên miền riêng thì không cần điền.
            </p>
          </div>
        )}

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
