'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { ResetPasswordRequestSchema, type ResetPasswordRequest } from '@pms/shared-types';
import { Button, Input, Label, toast } from '@pms/ui';
import { useForm } from 'react-hook-form';
import { AuthCard } from '@/components/auth/AuthCard';
import { ApiClientError, apiClient } from '@/lib/api-client';

/** A4 /reset-password?token= (docs/ui/01): đặt mật khẩu mới (min 10). */
function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [confirm, setConfirm] = useState('');
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordRequest>({
    resolver: zodResolver(ResetPasswordRequestSchema),
    defaultValues: { token },
  });

  if (!token) {
    return (
      <AuthCard
        title="Link không hợp lệ"
        description="Thiếu mã đặt lại mật khẩu trong đường dẫn."
        footer={
          <Link
            href="/forgot-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Yêu cầu link mới
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Hãy mở link đặt lại mật khẩu trực tiếp từ email, hoặc yêu cầu link mới.
        </p>
      </AuthCard>
    );
  }

  const onSubmit = async (values: ResetPasswordRequest) => {
    if (values.new_password !== confirm) {
      toast.error('Mật khẩu xác nhận không khớp');
      return;
    }
    try {
      await apiClient.post('/auth/reset-password', values);
      toast.success('Đặt lại mật khẩu thành công — đăng nhập lại');
      router.push('/login');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Link hết hạn hoặc không hợp lệ');
    }
  };

  const mismatch = confirm.length > 0 && watch('new_password') !== confirm;

  return (
    <AuthCard
      title="Đặt lại mật khẩu"
      description="Chọn mật khẩu mới cho tài khoản của bạn"
      footer={
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          ← Quay lại đăng nhập
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
        <input type="hidden" {...register('token')} />
        <div className="grid gap-2">
          <Label htmlFor="new_password">Mật khẩu mới</Label>
          <Input
            id="new_password"
            type="password"
            autoComplete="new-password"
            className="h-11"
            {...register('new_password')}
          />
          {errors.new_password ? (
            <p className="text-sm text-destructive">{errors.new_password.message}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Tối thiểu 10 ký tự</p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Xác nhận mật khẩu</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            className="h-11"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && <p className="text-sm text-destructive">Mật khẩu xác nhận không khớp</p>}
        </div>
        <Button type="submit" disabled={isSubmitting} className="h-11 w-full text-base">
          Đặt lại mật khẩu
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
