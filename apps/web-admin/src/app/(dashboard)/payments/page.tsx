'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton } from '@pms/ui';
import { vnd } from '@/lib/format';
import { type PaymentFilters, usePaymentsByProperty } from '@/lib/hooks/use-invoices';
import { useT } from '@/lib/i18n';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { PaymentStatusBadge, paymentMethodLabel } from '@/components/payments/badges';

// 'ALL' = sentinel "mọi giá trị" (Radix Select không nhận value rỗng).
const STATUSES = [
  { value: 'ALL', label: 'Mọi trạng thái' },
  ...['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'].map((s) => ({ value: s, label: s })),
];
const METHODS = [
  { value: 'ALL', label: 'Mọi phương thức' },
  ...['CASH', 'BANK_TRANSFER', 'VIETQR', 'MOMO', 'ZALOPAY', 'CARD', 'OTA_COLLECTED', 'OTHER'].map((m) => ({
    value: m,
    label: paymentMethodLabel(m),
  })),
];

function fmt(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
}

/** F3 /payments — sổ thanh toán theo cơ sở + filter (A3). Bấm dòng → mở hoá đơn. */
export default function PaymentsPage() {
  const t = useT();
  const router = useRouter();
  const propertyId = usePropertyStore((s) => s.selectedId);
  const [filters, setFilters] = useState<PaymentFilters>({ page: 1 });
  const { data, isLoading } = usePaymentsByProperty(propertyId, filters);

  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Sổ thanh toán" />
        <p className="text-sm text-muted-foreground">{t('calendar.selectProperty')}</p>
      </PageContainer>
    );
  }

  const payments = data?.data ?? [];
  const pageInfo = data?.page_info;

  return (
    <PageContainer>
      <PageHeader title="Sổ thanh toán" description="Mọi khoản thu/hoàn theo cơ sở — bấm dòng để mở hoá đơn." />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.status ?? 'ALL'}
          onValueChange={(v) => setFilters((f) => ({ ...f, status: v === 'ALL' ? undefined : v, page: 1 }))}
        >
          <SelectTrigger aria-label="Trạng thái" className="h-9 w-[13rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.method ?? 'ALL'}
          onValueChange={(v) => setFilters((f) => ({ ...f, method: v === 'ALL' ? undefined : v, page: 1 }))}
        >
          <SelectTrigger aria-label="Phương thức" className="h-9 w-[13rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Thời gian</th>
                <th className="px-3 py-2 font-medium">Phương thức</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 font-medium">Mã tham chiếu</th>
                <th className="px-3 py-2 text-right font-medium">Số tiền</th>
                <th className="px-3 py-2 text-right font-medium">Đã hoàn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    Chưa có thanh toán nào.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/invoices/${p.invoice_id}`)}
                    className="cursor-pointer hover:bg-accent"
                  >
                    <td className="px-3 py-2 text-muted-foreground">{fmt(p.created_at)}</td>
                    <td className="px-3 py-2">{paymentMethodLabel(p.method)}</td>
                    <td className="px-3 py-2">
                      <PaymentStatusBadge status={p.status} />
                    </td>
                    <td className="px-3 py-2 max-w-[14rem] truncate text-muted-foreground" title={p.reference_code ?? ''}>
                      {p.reference_code ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{vnd(p.amount_vnd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {p.refunded_amount_vnd > 0 ? vnd(p.refunded_amount_vnd) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {pageInfo && pageInfo.total_pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={(filters.page ?? 1) <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
          >
            Trước
          </Button>
          <span className="text-muted-foreground">
            {pageInfo.page}/{pageInfo.total_pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={(filters.page ?? 1) >= pageInfo.total_pages}
            onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
          >
            Sau
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
