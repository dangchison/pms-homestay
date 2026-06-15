'use client';

import { useState } from 'react';
import Link from 'next/link';
import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPasswordRequestSchema, type ForgotPasswordRequest } from '@pms/shared-types';
import { Button, Input, Label } from '@pms/ui';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { AuthCard } from '@/components/auth/AuthCard';
import { apiClient } from '@/lib/api-client';

/** A3 /forgot-password (docs/ui/01): thông báo TRUNG TÍNH (không lộ email tồn tại). */
export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordRequest>({ resolver: zodResolver(ForgotPasswordRequestSchema) });

  const onSubmit = async (values: ForgotPasswordRequest) => {
    // BE luôn 204 (chống enumeration) → màn neutral dù email tồn tại hay không.
    await apiClient.post('/auth/forgot-password', values).catch(() => undefined);
    setSent(true);
  };

  if (sent) {
    return (
      <AuthCard
        title="Kiểm tra email"
        description="Nếu email tồn tại trong hệ thống, chúng tôi đã gửi link đặt lại mật khẩu."
        footer={
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            ← Quay lại đăng nhập
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <MailCheck className="size-7 text-primary" />
          </span>
          <p className="text-sm text-muted-foreground">
            Link có hiệu lực <strong className="text-foreground">30 phút</strong>. Không thấy email?
            Kiểm tra hộp thư rác hoặc thử lại sau ít phút.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Quên mật khẩu"
      description="Nhập email tài khoản — chúng tôi sẽ gửi link đặt lại"
      footer={
        <Link
          href="/login"
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Quay lại đăng nhập
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
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
        <Button type="submit" disabled={isSubmitting} className="h-11 w-full text-base">
          Gửi link đặt lại
        </Button>
      </form>
    </AuthCard>
  );
}
