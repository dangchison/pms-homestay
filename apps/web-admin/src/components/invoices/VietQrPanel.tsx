'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@pms/ui';
import type { InvoiceResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';
import { vnd } from '@/lib/format';

const PAYABLE = new Set(['ISSUED', 'PARTIALLY_PAID', 'OVERDUE']);

/**
 * VietQrPanel (task 6.4, F2): hiện QR động (balance) → khách quét → webhook
 * `payment.received` (SSE) invalidate `['invoices']` → invoice refetch → balance về 0
 * → panel hiện tick xanh. QR tải qua getBlob (PNG có auth, KHÔNG nhúng token vào <img src>).
 */
export function VietQrPanel({ invoice }: { invoice: InvoiceResponse }) {
  const showQr = invoice.balance_vnd > 0 && PAYABLE.has(invoice.status);

  const { data: qrUrl, isLoading, error } = useQuery({
    queryKey: ['invoice-qr', invoice.id, invoice.balance_vnd],
    queryFn: async () => {
      const blob = await apiClient.getBlob(`/invoices/${invoice.id}/qr-image`);
      return URL.createObjectURL(blob);
    },
    enabled: showQr,
    staleTime: Infinity,
  });

  useEffect(
    () => () => {
      if (qrUrl) URL.revokeObjectURL(qrUrl);
    },
    [qrUrl],
  );

  if (invoice.status === 'PAID' || invoice.balance_vnd <= 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-booking-confirmed/40 bg-booking-confirmed/12 p-6 text-center">
        <CheckCircle2 className="size-10 text-booking-confirmed" />
        <p className="font-medium">Đã thanh toán đủ</p>
      </div>
    );
  }

  if (!showQr) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        Phát hành hoá đơn để nhận thanh toán qua VietQR.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium">Quét VietQR để chuyển khoản</p>
      {isLoading ? (
        <Skeleton className="size-48" />
      ) : error ? (
        <p className="text-sm text-destructive">Không tạo được mã QR (cấu hình tài khoản ngân hàng cơ sở?).</p>
      ) : (
        <img src={qrUrl} alt="VietQR" className="size-48 rounded-md" />
      )}
      <p className="text-sm text-muted-foreground">
        Còn lại: <span className="font-semibold text-foreground">{vnd(invoice.balance_vnd)}</span>
      </p>
      <p className="text-xs text-muted-foreground">Tự động xác nhận khi nhận được chuyển khoản.</p>
    </div>
  );
}
