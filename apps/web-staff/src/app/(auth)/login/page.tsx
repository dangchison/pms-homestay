import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@pms/ui';

/** Đăng nhập nhân viên (ui/02) — nối API ở task 6.6 (sau auth 1.7). */
export default function StaffLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>PMS Staff</CardTitle>
          <CardDescription>Dành cho lễ tân & buồng phòng</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="nhanvien@homestay.vn" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Mật khẩu</Label>
            <Input id="password" type="password" />
          </div>
          <Button className="w-full">Đăng nhập</Button>
        </CardContent>
      </Card>
    </main>
  );
}
