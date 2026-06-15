'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Skeleton,
  cn,
  toast,
} from '@pms/ui';
import type { ChargeSubscriptionResponse, SubscriptionPlan } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { usePayments, usePlans, useSubscription, useCharge } from '@/lib/hooks/use-billing';
import { vnd } from '@/lib/format';

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{used} / {max}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-warning' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** S3 /settings/billing — gói + usage + nâng cấp (VietQR) + lịch sử (task 6.7). */
export default function BillingPage() {
  const { data: sub, isLoading } = useSubscription();
  const { data: plans } = usePlans();
  const { data: payments } = usePayments();
  const charge = useCharge();
  const [qr, setQr] = useState<ChargeSubscriptionResponse | null>(null);

  const upgrade = async (plan: SubscriptionPlan) => {
    try {
      const res = await charge.mutateAsync(plan.code);
      setQr(res);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Không tạo được yêu cầu thanh toán');
    }
  };

  if (isLoading || !sub) return <Skeleton className="h-72 w-full rounded-xl" />;

  const trialDays = sub.status === 'TRIAL' ? daysUntil(sub.trial_ends_at) : null;

  return (
    <div className="grid gap-4">
      {sub.status === 'SUSPENDED' && (
        <div className="rounded-lg border border-destructive/40 bg-destructive-muted p-3 text-sm font-medium text-destructive">
          Tài khoản đang tạm ngưng — thanh toán để kích hoạt lại.
        </div>
      )}
      {trialDays !== null && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
          Đang dùng thử — còn {Math.max(0, trialDays)} ngày.
        </div>
      )}

      {/* Gói hiện tại + usage */}
      <Card>
        <CardContent className="grid gap-4 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Gói hiện tại</p>
              <p className="text-lg font-semibold">{sub.plan?.code ?? 'Chưa có gói'}</p>
            </div>
            <Badge variant="secondary">{sub.status}</Badge>
          </div>
          {sub.plan && (
            <div className="grid gap-3 sm:grid-cols-3">
              <UsageBar label="Cơ sở" used={sub.usage.properties} max={sub.plan.max_properties} />
              <UsageBar label="Phòng" used={sub.usage.rooms} max={sub.plan.max_rooms} />
              <UsageBar label="Người dùng" used={sub.usage.users} max={sub.plan.max_users} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danh sách gói */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(plans ?? []).map((p) => {
          const current = p.code === sub.plan?.code;
          return (
            <Card key={p.id} className={cn(current && 'border-primary')}>
              <CardContent className="grid gap-2 py-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{p.code}</span>
                  {current && <Badge className="text-[10px]">Hiện tại</Badge>}
                </div>
                <p className="text-lg font-bold">{vnd(p.monthly_price_vnd)}<span className="text-xs font-normal text-muted-foreground">/tháng</span></p>
                <ul className="text-xs text-muted-foreground">
                  <li>{p.max_properties} cơ sở</li>
                  <li>{p.max_rooms} phòng</li>
                  <li>{p.max_users} người dùng</li>
                </ul>
                <Button
                  size="sm"
                  variant={current ? 'outline' : 'default'}
                  disabled={current || p.monthly_price_vnd <= 0 || charge.isPending}
                  onClick={() => upgrade(p)}
                  className="mt-1"
                >
                  {current ? 'Đang dùng' : p.monthly_price_vnd <= 0 ? 'Miễn phí' : 'Nâng cấp'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Lịch sử thanh toán */}
      {(payments?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {payments!.map((pm) => (
                <div key={pm.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <span className="font-medium">{pm.plan_code}</span>
                    <span className="ml-2 text-muted-foreground">{pm.payment_ref}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>{vnd(pm.amount_vnd)}</span>
                    <Badge variant={pm.status === 'CONFIRMED' ? 'secondary' : 'outline'} className="text-[10px]">{pm.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* QR thanh toán nâng cấp */}
      <Dialog open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thanh toán nâng cấp gói</DialogTitle>
          </DialogHeader>
          {qr && (
            <div className="grid gap-3 text-sm">
              <img
                src={`https://img.vietqr.io/image/${qr.qr.bank_bin}-${qr.qr.account_number}-compact2.png?amount=${qr.qr.amount_vnd}&addInfo=${encodeURIComponent(qr.qr.add_info)}`}
                alt="VietQR"
                className="mx-auto size-52 rounded-md border border-border"
              />
              <div className="grid gap-1 rounded-md bg-muted p-3">
                <Row label="Số tiền" value={vnd(qr.qr.amount_vnd)} />
                <Row label="Số tài khoản" value={qr.qr.account_number} />
                <Row label="Nội dung" value={qr.qr.add_info} />
              </div>
              <p className="text-xs text-muted-foreground">
                Sau khi chuyển khoản, gói sẽ được kích hoạt khi quản trị nền tảng xác nhận thanh toán.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
