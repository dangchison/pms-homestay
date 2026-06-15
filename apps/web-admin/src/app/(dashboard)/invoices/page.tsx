'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Skeleton } from '@pms/ui';
import { vnd } from '@/lib/format';
import { type InvoiceFilters, useInvoices } from '@/lib/hooks/use-invoices';
import { useT } from '@/lib/i18n';
import { usePropertyStore } from '@/stores/property.store';
import { InvoiceKindBadge, InvoiceStatusBadge } from '@/components/invoices/badges';

const STATUSES = ['', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'];
const KINDS = ['', 'DEPOSIT', 'STAY', 'MONTHLY_RENT', 'ADJUSTMENT'];

/** F1 /invoices — danh sách hoá đơn theo cơ sở + filter (task 6.4). */
export default function InvoicesPage() {
  const t = useT();
  const router = useRouter();
  const propertyId = usePropertyStore((s) => s.selectedId);
  const [filters, setFilters] = useState<InvoiceFilters>({ page: 1 });
  const { data, isLoading, isFetching } = useInvoices(propertyId, filters);

  if (!propertyId) {
    return <div className="p-6 text-sm text-muted-foreground">{t('calendar.selectProperty')}</div>;
  }

  const invoices = data?.data ?? [];
  const pageInfo = data?.page_info;

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Hoá đơn</h1>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Trạng thái"
          value={filters.status ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined, page: 1 }))}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === '' ? 'Mọi trạng thái' : s}</option>
          ))}
        </select>
        <select
          aria-label="Loại"
          value={filters.kind ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value || undefined, page: 1 }))}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>{k === '' ? 'Mọi loại' : k}</option>
          ))}
        </select>
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
    </div>
  );
}
