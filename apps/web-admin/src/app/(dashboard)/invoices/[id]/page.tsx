'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  cn,
  toast,
} from '@pms/ui';
import type { InvoiceResponse, PaymentResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { vnd } from '@/lib/format';
import {
  useInvoice,
  usePaymentsByInvoice,
  useIssueInvoice,
  useRefundPayment,
  useVoidInvoice,
} from '@/lib/hooks/use-invoices';
import { InvoiceKindBadge, InvoiceStatusBadge } from '@/components/invoices/badges';
import { RecordPaymentDialog } from '@/components/invoices/RecordPaymentDialog';
import { VietQrPanel } from '@/components/invoices/VietQrPanel';

const PAYABLE = new Set(['ISSUED', 'PARTIALLY_PAID', 'OVERDUE']);
const PAY_STATUS: Record<string, string> = {
  PENDING: 'Chờ', SUCCEEDED: 'Thành công', FAILED: 'Thất bại', REFUNDED: 'Đã hoàn', PARTIALLY_REFUNDED: 'Hoàn một phần',
};

export default function InvoiceDetailPage() {
  const id = String(useParams().id);
  const { data: invoice, isLoading } = useInvoice(id);
  const { data: payments } = usePaymentsByInvoice(id);
  const [paying, setPaying] = useState(false);
  const [refundTarget, setRefundTarget] = useState<PaymentResponse | null>(null);
  const [voiding, setVoiding] = useState(false);

  if (isLoading || !invoice) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const payable = PAYABLE.has(invoice.status);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{invoice.invoice_number}</h1>
        <InvoiceKindBadge kind={invoice.kind} />
        <InvoiceStatusBadge status={invoice.status} />
        <div className="ml-auto flex gap-2">
          {invoice.status === 'DRAFT' && <IssueButton id={invoice.id} />}
          {payable && <Button size="sm" onClick={() => setPaying(true)}>Thu tiền</Button>}
          {invoice.status !== 'VOID' && (
            <Button size="sm" variant="outline" onClick={() => setVoiding(true)}>Hủy hoá đơn</Button>
          )}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {/* Items */}
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Khoản mục</th>
                  <th className="px-3 py-2 text-right font-medium">SL</th>
                  <th className="px-3 py-2 text-right font-medium">Thành tiền</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {invoice.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2">
                      {it.description}
                      {it.item_type === 'DEPOSIT_APPLIED' && (
                        <span className="ml-2 text-xs text-emerald-600">Cấn cọc</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{it.quantity}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', it.amount_vnd < 0 && 'text-emerald-600')}>
                      {vnd(it.amount_vnd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <dl className="space-y-1 rounded-lg border border-border p-4 text-sm">
            <Row label="Tạm tính" value={vnd(invoice.subtotal_vnd)} muted />
            {invoice.discount_vnd !== 0 && <Row label="Giảm giá" value={vnd(-Math.abs(invoice.discount_vnd))} muted />}
            {invoice.tax_vnd !== 0 && <Row label="Thuế" value={vnd(invoice.tax_vnd)} muted />}
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <span>Tổng</span>
              <span className="tabular-nums">{vnd(invoice.total_vnd)}</span>
            </div>
            <Row label="Đã trả" value={vnd(invoice.paid_vnd)} muted />
            <div className="flex justify-between font-medium">
              <span>Còn lại</span>
              <span className={cn('tabular-nums', invoice.balance_vnd > 0 ? 'text-destructive' : 'text-booking-confirmed')}>
                {vnd(invoice.balance_vnd)}
              </span>
            </div>
          </dl>

          {/* Payments */}
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="mb-2 font-medium">Thanh toán</p>
            {!payments || payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có thanh toán.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {payments.map((p) => {
                  const remaining = p.amount_vnd - p.refunded_amount_vnd;
                  const canRefund = (p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED') && remaining > 0;
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        <span className="font-medium tabular-nums">{vnd(p.amount_vnd)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {p.method} · {PAY_STATUS[p.status] ?? p.status}
                          {p.refunded_amount_vnd > 0 && ` · hoàn ${vnd(p.refunded_amount_vnd)}`}
                        </span>
                      </span>
                      {canRefund && (
                        <Button size="sm" variant="ghost" onClick={() => setRefundTarget(p)}>
                          Hoàn tiền
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <VietQrPanel invoice={invoice} />
        </div>
      </div>

      {paying && <RecordPaymentDialog invoice={invoice} onClose={() => setPaying(false)} />}
      {refundTarget && <RefundDialog payment={refundTarget} onClose={() => setRefundTarget(null)} />}
      {voiding && <VoidDialog invoice={invoice} onClose={() => setVoiding(false)} />}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn('flex justify-between', muted && 'text-muted-foreground')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function IssueButton({ id }: { id: string }) {
  const issue = useIssueInvoice();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={issue.isPending}
      onClick={async () => {
        try {
          await issue.mutateAsync(id);
          toast.success('Đã phát hành hoá đơn');
        } catch (err) {
          toast.error(err instanceof ApiClientError ? err.message : 'Phát hành thất bại');
        }
      }}
    >
      Phát hành
    </Button>
  );
}

function RefundDialog({ payment, onClose }: { payment: PaymentResponse; onClose: () => void }) {
  const remaining = payment.amount_vnd - payment.refunded_amount_vnd;
  const [amount, setAmount] = useState(remaining);
  const [reason, setReason] = useState('');
  const refund = useRefundPayment();

  async function submit() {
    if (reason.trim().length < 1) {
      toast.error('Cần nhập lý do hoàn tiền');
      return;
    }
    try {
      await refund.mutateAsync({ paymentId: payment.id, body: { amount_vnd: amount, reason: reason.trim() } });
      toast.success('Đã hoàn tiền');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Hoàn tiền thất bại');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hoàn tiền</DialogTitle>
          <DialogDescription>Ghi nhận khoản hoàn trả cho khách.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="rf-amount">Số tiền (tối đa {vnd(remaining)})</Label>
            <Input id="rf-amount" type="number" min={1} max={remaining} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rf-reason">Lý do</Label>
            <Input id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: khách hủy phòng" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Hủy</Button>
          <Button variant="destructive" onClick={submit} disabled={refund.isPending}>
            {refund.isPending ? 'Đang hoàn…' : 'Xác nhận hoàn'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ invoice, onClose }: { invoice: InvoiceResponse; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const voidInv = useVoidInvoice();

  async function submit() {
    if (reason.trim().length < 1) {
      toast.error('Cần nhập lý do hủy');
      return;
    }
    try {
      await voidInv.mutateAsync({ id: invoice.id, reason: reason.trim() });
      toast.success('Đã hủy hoá đơn (giữ số)');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Hủy hoá đơn thất bại');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hủy hoá đơn {invoice.invoice_number}</DialogTitle>
        </DialogHeader>
        <DialogDescription>Hoá đơn vẫn giữ số (audit). Hành động không thể hoàn tác.</DialogDescription>
        <div className="mt-2 grid gap-1.5">
          <Label htmlFor="vd-reason">Lý do hủy</Label>
          <Input id="vd-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Đóng</Button>
          <Button variant="destructive" onClick={submit} disabled={voidInv.isPending}>
            {voidInv.isPending ? 'Đang hủy…' : 'Xác nhận hủy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
