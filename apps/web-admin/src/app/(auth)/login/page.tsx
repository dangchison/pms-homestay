'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@pms/shared-types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  toast,
} from '@pms/ui';
import { useForm } from 'react-hook-form';

/**
 * Đăng nhập (ui/01 §auth) — form validate bằng CHÍNH schema BE sẽ dùng
 * (@pms/shared-types). Gọi API thật khi auth module hoàn thành (task 1.7).
 */
export default function LoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(LoginRequestSchema) });

  const onSubmit = (_values: LoginRequest) => {
    // TODO(task 1.7): POST /api/v1/auth/login qua api-client, lưu access token in-memory
    toast.info('Auth API sẽ có ở task 1.7 — form + schema dùng chung đã sẵn sàng');
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>PMS Homestay</CardTitle>
        <CardDescription>Đăng nhập trang quản trị</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="ban@homestay.vn" {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Mật khẩu</Label>
            <Input id="password" type="password" {...register('password')} />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>
          <Button type="submit" disabled={isSubmitting} className="w-full">
            Đăng nhập
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
