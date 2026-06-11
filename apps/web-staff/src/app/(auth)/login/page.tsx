'use client';

import { Button, Card, CardContent, Input, Label, toast } from '@pms/ui';
import { Home, Smartphone } from 'lucide-react';

/**
 * T1 /login (docs/ui/02): đăng nhập nhân viên, lưu tenant slug lần trước,
 * gợi ý thêm vào màn hình chính (A2HS). Nối API ở task 6.6.
 */
export default function StaffLoginPage() {
  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-b from-teal-600 to-teal-700">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-white">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
          <Home className="size-7" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">PMS Staff</h1>
        <p className="text-sm text-teal-50/90">Lễ tân & buồng phòng — nhanh, một tay</p>
      </div>

      <Card className="rounded-b-none rounded-t-3xl border-0 shadow-2xl">
        <CardContent className="mx-auto grid w-full max-w-sm gap-5 px-6 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="grid gap-2">
            <Label htmlFor="tenant">Mã homestay (tenant)</Label>
            <Input id="tenant" placeholder="vd: demo" className="h-12 text-base" />
            {/* TODO(task 6.6): nhớ slug lần trước (localStorage) */}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="nhanvien@homestay.vn"
              className="h-12 text-base"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Mật khẩu</Label>
            <Input id="password" type="password" className="h-12 text-base" />
          </div>

          <Button
            className="h-12 w-full text-base"
            onClick={() => toast.info('Nối API login ở task 6.6 — backend đã sẵn sàng')}
          >
            Đăng nhập
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Smartphone className="size-3.5" />
            Mẹo: thêm vào màn hình chính để dùng như app
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
