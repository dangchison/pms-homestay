'use client';

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@pms/ui';
import type { InvoiceResponse, PaymentMethod } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { vnd } from '@/lib/format';
import { useRecordPayment } from '@/lib/hooks/use-invoices';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Tiền mặt' },
  { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
  { value: 'VIETQR', label: 'VietQR' },
  { value: 'MOMO', label: 'MoMo' },
  { value: 'CARD', label: 'Thẻ' },
  { value: 'OTHER', label: 'Khác' },
];

/** Dialog ghi nhận thanh toán (task 6.4, F2). Mount khi mở → state khởi tạo mới mỗi lần. */
export function RecordPaymentDialog({ invoice, onClose }: { invoice: InvoiceResponse; onClose: () => void }) {
  const [amount, setAmount] = useState(invoice.balance_vnd);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [ref, setRef] = useState('');
  const record = useRecordPayment();

  async function submit() {
    if (amount <= 0) {
      toast.error('Số tiền phải lớn hơn 0');
      return;
    }
    try {
      await record.mutateAsync({
        body: { invoice_id: invoice.id, amount_vnd: amount, method, reference_code: ref || undefined },
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success('Đã ghi nhận thanh toán');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Ghi nhận thất bại');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ghi nhận thanh toán</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pay-method">Phương thức</Label>
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pay-amount">Số tiền (mặc định = còn lại {vnd(invoice.balance_vnd)})</Label>
            <Input
              id="pay-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pay-ref">Mã tham chiếu (tuỳ chọn)</Label>
            <Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Mã CK / biên lai" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending ? 'Đang ghi…' : 'Ghi nhận'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
