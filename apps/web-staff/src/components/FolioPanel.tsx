'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardContent, Separator, Skeleton } from '@pms/ui';
import { Banknote, Receipt } from 'lucide-react';
import type { InvoiceResponse } from '@pms/shared-types';
import { useInvoicesByBooking } from '@/lib/hooks/use-invoices';
import { VietQrPanel } from './VietQrPanel';
import { RecordCashDialog } from './RecordCashDialog';
import { vnd } from '@/lib/format';

const KIND_LABEL: Record<string, string> = {
  DEPOSIT: 'Tiền cọc',
  STAY: 'Tiền phòng',
  MONTHLY_RENT: 'Tiền thuê tháng',
  ADJUSTMENT: 'Điều chỉnh',
};
const PAYABLE = new Set(['ISSUED', 'PARTIALLY_PAID', 'OVERDUE']);

/**
 * Folio + thu tiền (ui/02 #T3③/#T4): liệt kê hoá đơn của booking, mỗi hoá đơn còn
 * nợ → VietQR (tick realtime) + nút ghi nhận tiền mặt/CK. Tái dùng cho thu cọc
 * (check-in) lẫn thu nốt tiền phòng (check-out). `kindFilter` lọc loại hoá đơn.
 */
export function FolioPanel({
  bookingId,
  online,
  kindFilter,
  emptyHint,
}: {
  bookingId: string;
  online: boolean;
  kindFilter?: (kind: string) => boolean;
  emptyHint?: string;
}) {
  const { data: invoices, isLoading } = useInvoicesByBooking(bookingId);
  const [payFor, setPayFor] = useState<InvoiceResponse | null>(null);

  if (isLoading) return <Skeleton className="h-32 w-full rounded-xl" />;

  const list = (invoices ?? []).filter((i) => i.status !== 'VOID' && (!kindFilter || kindFilter(i.kind)));
  if (list.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
          <Receipt className="size-6 text-muted-foreground/40" />
          {emptyHint ?? 'Chưa có hoá đơn'}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {list.map((inv) => {
        const payable = inv.balance_vnd > 0 && PAYABLE.has(inv.status);
        return (
          <Card key={inv.id}>
            <CardContent className="grid gap-3 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{KIND_LABEL[inv.kind] ?? inv.kind}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {inv.invoice_number}
                  </Badge>
                </div>
                <span className="text-sm text-muted-foreground">{vnd(inv.total_vnd)}</span>
              </div>

              {inv.items.length > 0 && (
                <div className="grid gap-1 text-sm">
                  {inv.items.map((it) => (
                    <div key={it.id} className="flex justify-between text-muted-foreground">
                      <span className="truncate pr-2">{it.description}</span>
                      <span className={it.amount_vnd < 0 ? 'text-success' : ''}>{vnd(it.amount_vnd)}</span>
                    </div>
                  ))}
                </div>
              )}

              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span>Đã thu</span>
                <span>{vnd(inv.paid_vnd)}</span>
              </div>
              <div className="flex items-center justify-between font-semibold">
                <span>Còn lại</span>
                <span className={inv.balance_vnd > 0 ? 'text-destructive' : 'text-success'}>
                  {vnd(inv.balance_vnd)}
                </span>
              </div>

              {payable && (
                <>
                  <VietQrPanel invoice={inv} />
                  <Button
                    variant="outline"
                    className="h-11 w-full"
                    disabled={!online}
                    onClick={() => setPayFor(inv)}
                  >
                    <Banknote className="size-4" />
                    Ghi nhận tiền mặt / CK
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}

      {payFor && (
        <RecordCashDialog
          invoice={payFor}
          open={!!payFor}
          onOpenChange={(o) => !o && setPayFor(null)}
          disabled={!online}
        />
      )}
    </div>
  );
}
