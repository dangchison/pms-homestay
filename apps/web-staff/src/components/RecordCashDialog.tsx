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
import { Loader2 } from 'lucide-react';
import type { InvoiceResponse, PaymentMethod } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useRecordPayment } from '@/lib/hooks/use-invoices';
import { vnd } from '@/lib/format';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Tiền mặt' },
  { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
  { value: 'CARD', label: 'Thẻ' },
];

/** Ghi nhận thanh toán thủ công cho 1 hoá đơn (mặc định = số còn lại, tiền mặt). */
export function RecordCashDialog({
  invoice,
  open,
  onOpenChange,
  disabled,
}: {
  invoice: InvoiceResponse;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  disabled?: boolean;
}) {
  const [amount, setAmount] = useState(invoice.balance_vnd);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const record = useRecordPayment();

  const submit = async () => {
    if (amount <= 0 || amount > invoice.balance_vnd) {
      toast.error('Số tiền không hợp lệ');
      return;
    }
    try {
      await record.mutateAsync({
        body: { invoice_id: invoice.id, amount_vnd: amount, method },
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success('Đã ghi nhận thanh toán');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Ghi nhận thất bại');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ghi nhận thanh toán</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="amount">Số tiền (còn lại {vnd(invoice.balance_vnd)})</Label>
            <Input
              id="amount"
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="h-12 text-base"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="method">Phương thức</Label>
            <select
              id="method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="h-12 rounded-md border border-border bg-card px-3 text-base"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button
            className="h-12 w-full text-base"
            disabled={disabled || record.isPending}
            onClick={submit}
          >
            {record.isPending ? <Loader2 className="size-5 animate-spin" /> : `Ghi nhận ${vnd(amount || 0)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
