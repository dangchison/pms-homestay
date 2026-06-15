'use client';

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Skeleton,
  toast,
} from '@pms/ui';
import type { UnmatchedPaymentResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { vnd } from '@/lib/format';
import { useInvoices } from '@/lib/hooks/use-invoices';
import { useIgnoreUnmatched, useResolveUnmatched, useUnmatched } from '@/lib/hooks/use-unmatched';
import { usePropertyStore } from '@/stores/property.store';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}

/** F4 /payments/unmatched — đối soát biến động ngân hàng chưa khớp (task 6.4). */
export default function UnmatchedPage() {
  const { data: rows, isLoading } = useUnmatched();
  const ignore = useIgnoreUnmatched();
  const [resolveTarget, setResolveTarget] = useState<UnmatchedPaymentResponse | null>(null);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">Đối soát thanh toán</h1>
        <p className="text-sm text-muted-foreground">Biến động ngân hàng chưa tự khớp — match tay vào hoá đơn hoặc bỏ qua.</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Nguồn</th>
                <th className="px-3 py-2 font-medium">Nội dung</th>
                <th className="px-3 py-2 text-right font-medium">Số tiền</th>
                <th className="px-3 py-2 font-medium">Thời gian</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {!rows || rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Không có giao dịch chưa khớp.</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{r.provider}</td>
                    <td className="px-3 py-2 max-w-[18rem] truncate" title={r.content ?? ''}>{r.content ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{vnd(r.amount_vnd)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmt(r.received_at)}</td>
                    <td className="px-3 py-2 text-xs">{r.status}</td>
                    <td className="px-3 py-2 text-right">
                      {r.status === 'PENDING' && (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" onClick={() => setResolveTarget(r)}>Khớp</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={ignore.isPending}
                            onClick={async () => {
                              try {
                                await ignore.mutateAsync(r.id);
                                toast.success('Đã bỏ qua');
                              } catch (err) {
                                toast.error(err instanceof ApiClientError ? err.message : 'Bỏ qua thất bại');
                              }
                            }}
                          >
                            Bỏ qua
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {resolveTarget && <ResolveDialog unmatched={resolveTarget} onClose={() => setResolveTarget(null)} />}
    </div>
  );
}

function ResolveDialog({ unmatched, onClose }: { unmatched: UnmatchedPaymentResponse; onClose: () => void }) {
  const propertyId = usePropertyStore((s) => s.selectedId);
  const { data } = useInvoices(propertyId, {});
  const [invoiceId, setInvoiceId] = useState('');
  const resolve = useResolveUnmatched();

  // Gợi ý: hoá đơn còn nợ, ưu tiên balance == số tiền giao dịch.
  const candidates = (data?.data ?? []).filter((i) => i.balance_vnd > 0);

  async function submit() {
    if (!invoiceId) {
      toast.error('Chọn hoá đơn để khớp');
      return;
    }
    try {
      await resolve.mutateAsync({ id: unmatched.id, invoiceId });
      toast.success('Đã khớp giao dịch vào hoá đơn');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Khớp thất bại');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Khớp giao dịch {vnd(unmatched.amount_vnd)}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{unmatched.content ?? 'Không có nội dung CK'}</p>
        {!propertyId ? (
          <p className="mt-2 text-sm text-muted-foreground">Chọn một cơ sở (TopBar) để liệt kê hoá đơn còn nợ.</p>
        ) : (
          <div className="mt-2 grid gap-1.5">
            <Label htmlFor="rs-invoice">Hoá đơn (cơ sở đang chọn, còn nợ)</Label>
            <select
              id="rs-invoice"
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none"
            >
              <option value="">— Chọn hoá đơn —</option>
              {candidates.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_number} · còn {vnd(i.balance_vnd)}
                  {i.balance_vnd === unmatched.amount_vnd ? ' ✓ khớp số tiền' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Hủy</Button>
          <Button onClick={submit} disabled={resolve.isPending || !invoiceId}>
            {resolve.isPending ? 'Đang khớp…' : 'Khớp'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
