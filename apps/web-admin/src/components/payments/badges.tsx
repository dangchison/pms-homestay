import { cn } from '@pms/ui';

/** Badge trạng thái thanh toán (A3 F3) — token chung; SUCCEEDED xanh, FAILED đỏ. */
const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Chờ', cls: 'border-booking-pending/40 bg-booking-pending/12 text-foreground' },
  SUCCEEDED: { label: 'Thành công', cls: 'border-booking-confirmed/40 bg-booking-confirmed/12 text-foreground' },
  FAILED: { label: 'Thất bại', cls: 'border-destructive/40 bg-destructive-muted text-foreground' },
  REFUNDED: { label: 'Đã hoàn', cls: 'border-border bg-muted text-muted-foreground' },
  PARTIALLY_REFUNDED: { label: 'Hoàn một phần', cls: 'border-border bg-muted text-muted-foreground' },
};

const PAYMENT_METHOD: Record<string, string> = {
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  VIETQR: 'VietQR',
  MOMO: 'MoMo',
  ZALOPAY: 'ZaloPay',
  CARD: 'Thẻ',
  OTA_COLLECTED: 'OTA thu hộ',
  OTHER: 'Khác',
};

export function PaymentStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = PAYMENT_STATUS[status] ?? { label: status, cls: 'border-border bg-muted text-muted-foreground' };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        s.cls,
        className,
      )}
    >
      {s.label}
    </span>
  );
}

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD[method] ?? method;
}
