'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton } from '@pms/ui';
import { vnd } from '@/lib/format';
import { type InvoiceFilters, useInvoices } from '@/lib/hooks/use-invoices';
import { useT } from '@/lib/i18n';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { InvoiceKindBadge, InvoiceStatusBadge } from '@/components/invoices/badges';

// 'ALL' = sentinel "mọi giá trị" (Radix Select không nhận value rỗng).
const STATUSES = [
  { value: 'ALL', label: 'Mọi trạng thái' },
  ...['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'].map((s) => ({ value: s, label: s })),
];
const KINDS = [
  { value: 'ALL', label: 'Mọi loại' },
  ...['DEPOSIT', 'STAY', 'MONTHLY_RENT', 'ADJUSTMENT'].map((k) => ({ value: k, label: k })),
];

/** F1 /invoices — danh sách hoá đơn theo cơ sở + filter (task 6.4). */
export default function InvoicesPage() {
  const t = useT();
  const router = useRouter();
  const propertyId = usePropertyStore((s) => s.selectedId);
  const [filters, setFilters] = useState<InvoiceFilters>({ page: 1 });
  const { data, isLoading, isFetching } = useInvoices(propertyId, filters);

  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Hoá đơn" />
        <p className="text-sm text-muted-foreground">{t('calendar.selectProperty')}</p>
      </PageContainer>
    );
  }

  const invoices = data?.data ?? [];
  const pageInfo = data?.page_info;

  return (
    <PageContainer>
      <PageHeader title="Hoá đơn" />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.status ?? 'ALL'}
          onValueChange={(v) => setFilters((f) => ({ ...f, status: v === 'ALL' ? undefined : v, page: 1 }))}
        >
          <SelectTrigger aria-label="Trạng thái" className="h-9 w-[12rem]">
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
          value={filters.kind ?? 'ALL'}
          onValueChange={(v) => setFilters((f) => ({ ...f, kind: v === 'ALL' ? undefined : v, page: 1 }))}
        >
          <SelectTrigger aria-label="Loại" className="h-9 w-[11rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isFetching && <span className="text-xs text-muted-foreground">Đang tải…</span>}
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Số hoá đơn</th>
                <th className="px-3 py-2 font-medium">Loại</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 text-right font-medium">Tổng</th>
                <th className="px-3 py-2 text-right font-medium">Còn lại</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Không có hoá đơn.</td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                    className="cursor-pointer hover:bg-accent"
                  >
                    <td className="px-3 py-2 font-medium">{inv.invoice_number}</td>
                    <td className="px-3 py-2"><InvoiceKindBadge kind={inv.kind} /></td>
                    <td className="px-3 py-2"><InvoiceStatusBadge status={inv.status} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{vnd(inv.total_vnd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{vnd(inv.balance_vnd)}</td>
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
