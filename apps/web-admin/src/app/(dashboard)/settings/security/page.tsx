'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardContent, Input, Label, Separator, toast } from '@pms/ui';
import { Loader2, Monitor, ShieldCheck } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import {
  use2faDisable,
  use2faEnable,
  use2faVerify,
  useChangePassword,
  useRevokeSession,
  useSessions,
} from '@/lib/hooks/use-security';

function fmt(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

/** S4 /settings/security — đổi mật khẩu, 2FA, phiên đăng nhập (task 6.7). */
export default function SecurityPage() {
  return (
    <div className="grid gap-4">
      <ChangePasswordCard />
      <TwoFaCard />
      <SessionsCard />
    </div>
  );
}

function ChangePasswordCard() {
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const submit = async () => {
    if (next.length < 10) {
      toast.error('Mật khẩu mới tối thiểu 10 ký tự');
      return;
    }
    if (next !== confirm) {
      toast.error('Xác nhận mật khẩu không khớp');
      return;
    }
    try {
      await change.mutateAsync({ current_password: current, new_password: next });
      toast.success('Đã đổi mật khẩu');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Đổi mật khẩu thất bại');
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-3 py-5">
        <h2 className="font-semibold">Đổi mật khẩu</h2>
        <div className="grid gap-3 sm:max-w-sm">
          <div className="grid gap-1.5">
            <Label htmlFor="cur">Mật khẩu hiện tại</Label>
            <Input id="cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new">Mật khẩu mới</Label>
            <Input id="new" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cf">Xác nhận mật khẩu mới</Label>
            <Input id="cf" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button onClick={submit} disabled={change.isPending} className="justify-self-start">
            {change.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Cập nhật
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TwoFaCard() {
  const enable = use2faEnable();
  const verify = use2faVerify();
  const disable = use2faDisable();
  const [enrollment, setEnrollment] = useState<{ secret: string; backup_codes: string[]; otpauth_url: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');

  const startEnable = async () => {
    try {
      setEnrollment(await enable.mutateAsync());
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        toast.info('2FA đã được bật — dùng phần "Tắt 2FA" bên dưới nếu muốn gỡ.');
      } else {
        toast.error('Không khởi tạo được 2FA');
      }
    }
  };

  const doVerify = async () => {
    try {
      await verify.mutateAsync(verifyCode);
      toast.success('Đã bật 2FA');
      setEnrollment(null);
      setVerifyCode('');
    } catch {
      toast.error('Mã xác thực không đúng');
    }
  };

  const doDisable = async () => {
    try {
      await disable.mutateAsync(disableCode);
      toast.success('Đã tắt 2FA');
      setDisableCode('');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Tắt 2FA thất bại');
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-3 py-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <h2 className="font-semibold">Xác thực 2 lớp (2FA)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Bắt buộc với OWNER/ACCOUNTANT. Dùng app như Google Authenticator / Authy.
        </p>

        {!enrollment ? (
          <Button variant="outline" onClick={startEnable} disabled={enable.isPending} className="justify-self-start">
            {enable.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Bật 2FA
          </Button>
        ) : (
          <div className="grid gap-3 rounded-md border border-border p-3">
            <div className="grid gap-1">
              <Label className="text-xs">Khoá bí mật (nhập thủ công vào app)</Label>
              <code className="rounded bg-muted px-2 py-1 text-sm break-all">{enrollment.secret}</code>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Mã dự phòng (lưu nơi an toàn)</Label>
              <div className="flex flex-wrap gap-1">
                {enrollment.backup_codes.map((c) => (
                  <code key={c} className="rounded bg-muted px-1.5 py-0.5 text-xs">{c}</code>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="vc" className="text-xs">Nhập mã 6 số từ app để xác nhận</Label>
              <div className="flex gap-2">
                <Input id="vc" inputMode="numeric" maxLength={6} value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} />
                <Button onClick={doVerify} disabled={verify.isPending}>Xác nhận</Button>
              </div>
            </div>
          </div>
        )}

        <Separator />
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="dc" className="text-xs">Tắt 2FA (nhập mã 6 số hiện tại)</Label>
          <div className="flex gap-2">
            <Input id="dc" inputMode="numeric" maxLength={6} value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
            <Button variant="outline" onClick={doDisable} disabled={disable.isPending} className="text-destructive">Tắt</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const { data: sessions, isLoading } = useSessions();
  const revoke = useRevokeSession();

  return (
    <Card>
      <CardContent className="grid gap-3 py-5">
        <h2 className="font-semibold">Phiên đăng nhập</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Đang tải…</p>
        ) : (
          <div className="divide-y divide-border">
            {(sessions ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-2.5">
                <Monitor className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{s.user_agent ?? 'Thiết bị không xác định'}</p>
                  <p className="text-xs text-muted-foreground">{s.ip_address ?? '—'} · {fmt(s.created_at)}</p>
                </div>
                {s.current ? (
                  <Badge variant="secondary" className="text-[10px]">Hiện tại</Badge>
                ) : (
                  <Button variant="ghost" size="sm" className="text-destructive" disabled={revoke.isPending} onClick={() => void revoke.mutateAsync(s.id)}>
                    Thu hồi
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
