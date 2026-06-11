'use client';

import { useState } from 'react';
import Link from 'next/link';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterTenantRequestSchema, type RegisterTenantRequest } from '@pms/shared-types';
import { Button, Input, Label, toast } from '@pms/ui';
import { useForm } from 'react-hook-form';
import { AuthCard } from '@/components/auth/AuthCard';

/** A2 /register (docs/ui/01): tạo tenant + OWNER, trial 14 ngày. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export default function RegisterPage() {
  const [slugEdited, setSlugEdited] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterTenantRequest>({ resolver: zodResolver(RegisterTenantRequestSchema) });

  const onSubmit = (_values: RegisterTenantRequest) => {
    // TODO(task 6.1): apiClient.post('/auth/register') → chuyển sang onboarding checklist
    toast.info('Nối API đăng ký ở task 6.1 — backend /auth/register đã chạy (tenant + OWNER, trial 14 ngày)');
  };

  return (
    <AuthCard
      title="Đăng ký dùng thử"
      description="Tạo tài khoản chủ nhà — miễn phí 14 ngày, không cần thẻ"
      footer={
        <>
          Đã có tài khoản?{' '}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Đăng nhập
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="tenant_display_name">Tên cơ sở kinh doanh</Label>
          <Input
            id="tenant_display_name"
            placeholder="Homestay Biển Xanh"
            className="h-11"
            {...register('tenant_display_name', {
              onChange: (e) => {
                if (!slugEdited) setValue('tenant_slug', slugify(e.target.value));
              },
            })}
          />
          {errors.tenant_display_name && (
            <p className="text-sm text-destructive">{errors.tenant_display_name.message}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="tenant_slug">Tên miền riêng</Label>
          <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
            <Input
              id="tenant_slug"
              placeholder="bien-xanh"
              className="h-11 border-0 focus-visible:ring-0"
              {...register('tenant_slug', { onChange: () => setSlugEdited(true) })}
            />
            <span className="shrink-0 px-3 text-sm text-muted-foreground">.pmsapp.vn</span>
          </div>
          {errors.tenant_slug && (
            <p className="text-sm text-destructive">{errors.tenant_slug.message}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="full_name">Họ tên của bạn</Label>
          <Input id="full_name" placeholder="Nguyễn Văn A" className="h-11" {...register('full_name')} />
          {errors.full_name && (
            <p className="text-sm text-destructive">{errors.full_name.message}</p>
          )}
        </div>

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
          <Label htmlFor="password">Mật khẩu</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            className="h-11"
            {...register('password')}
          />
          {errors.password ? (
            <p className="text-sm text-destructive">{errors.password.message}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Tối thiểu 10 ký tự</p>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} className="mt-1 h-11 w-full text-base">
          Tạo tài khoản
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Bằng việc đăng ký, bạn đồng ý với điều khoản dịch vụ & chính sách bảo mật (NĐ13).
        </p>
      </form>
    </AuthCard>
  );
}
