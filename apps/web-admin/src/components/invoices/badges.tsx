import { cn } from '@pms/ui';

/** Badge trạng thái hoá đơn (task 6.4) — token chung; PAID xanh, OVERDUE/VOID đỏ. */
const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Nháp', cls: 'border-border bg-muted text-muted-foreground' },
  ISSUED: { label: 'Đã phát hành', cls: 'border-primary/40 bg-primary/10 text-foreground' },
  PARTIALLY_PAID: { label: 'Trả một phần', cls: 'border-booking-pending/40 bg-booking-pending/12 text-foreground' },
  PAID: { label: 'Đã thanh toán', cls: 'border-booking-confirmed/40 bg-booking-confirmed/12 text-foreground' },
  OVERDUE: { label: 'Quá hạn', cls: 'border-destructive/40 bg-destructive-muted text-foreground' },
  VOID: { label: 'Đã hủy', cls: 'border-border bg-muted text-muted-foreground line-through' },
  REFUNDED: { label: 'Đã hoàn', cls: 'border-border bg-muted text-muted-foreground' },
};

const INVOICE_KIND: Record<string, string> = {
  DEPOSIT: 'Cọc',
  STAY: 'Lưu trú',
  MONTHLY_RENT: 'Thuê tháng',
  ADJUSTMENT: 'Điều chỉnh',
};

export function InvoiceStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = INVOICE_STATUS[status] ?? { label: status, cls: 'border-border bg-muted text-muted-foreground' };
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

export function InvoiceKindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center rounded bg-foreground/8 px-1.5 py-0.5 text-xs text-muted-foreground">
      {INVOICE_KIND[kind] ?? kind}
    </span>
  );
}
