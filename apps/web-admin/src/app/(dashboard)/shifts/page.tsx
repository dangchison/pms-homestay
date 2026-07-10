'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Skeleton,
  Textarea,
  toast,
} from '@pms/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { ShiftResponse, ShiftStatus } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { vnd } from '@/lib/format';
import { useCloseShift, useOpenShift, useShift, useShifts } from '@/lib/hooks/use-shifts';
import { useAuthStore } from '@/stores/auth.store';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';

const STATUS: Record<ShiftStatus, { label: string; variant: 'default' | 'secondary' }> = {
  OPEN: { label: 'Đang mở', variant: 'default' },
  CLOSED: { label: 'Đã đóng', variant: 'secondary' },
};

const VN_DATETIME = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const fmt = (iso: string) => VN_DATETIME.format(new Date(iso));

/** Chênh lệch (read-only, server-computed): âm → đỏ; 0 → thường; null (ca OPEN) → '—'. */
function VarianceCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return <span className={value < 0 ? 'text-destructive' : undefined}>{vnd(value)}</span>;
}

/** Task 2.3 /shifts — Sổ quỹ ca (docs/19 §3 Đợt 2). */
export default function ShiftsPage() {
  const propertyId = usePropertyStore((s) => s.selectedId);

  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Sổ quỹ ca" />
        <p className="text-sm text-muted-foreground">Chọn cơ sở để xem sổ quỹ ca.</p>
      </PageContainer>
    );
  }

  return <ShiftsView propertyId={propertyId} />;
}

function ShiftsView({ propertyId }: { propertyId: string }) {
  const role = useAuthStore((s) => s.user?.role);
  // payment.reconcile = OWNER/ACCOUNTANT → được mở/đóng ca. MANAGER (chỉ report.financial)
  // xem view-only. STAFF/HOUSEKEEPER không report.financial → GET 403 (bắt ở dưới).
  const canReconcile = role === 'OWNER' || role === 'ACCOUNTANT';

  const { data, isLoading, isError, error } = useShifts(propertyId);
  const shifts = data?.data ?? [];
  const hasOpenShift = shifts.some((s) => s.status === 'OPEN');

  const [openDialog, setOpenDialog] = useState(false);
  const [closeTarget, setCloseTarget] = useState<ShiftResponse | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const cols = canReconcile ? 7 : 6;

  return (
    <PageContainer>
      <PageHeader
        title="Sổ quỹ ca"
        description="Mở ca ghi tiền đầu ca → thu tiền mặt trong ca → đóng ca đếm tiền thực, đối chiếu chênh lệch quỹ."
        action={
          canReconcile ? (
            <Button disabled={hasOpenShift} onClick={() => setOpenDialog(true)}>
              Mở ca
            </Button>
          ) : undefined
        }
      />

      {isError ? (
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiClientError && error.status === 403
            ? 'Bạn không có quyền xem sổ quỹ ca.'
            : 'Không tải được sổ quỹ ca. Thử lại sau.'}
        </p>
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Mở lúc</th>
                <th className="px-3 py-2 font-medium">Đóng lúc</th>
                <th className="px-3 py-2 text-right font-medium">Tiền đầu ca</th>
                <th className="px-3 py-2 text-right font-medium">Đếm cuối ca</th>
                <th className="px-3 py-2 text-right font-medium">Chênh lệch</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                {canReconcile && <th className="px-3 py-2 font-medium">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shifts.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="px-3 py-6 text-center text-muted-foreground">
                    Chưa có ca nào cho cơ sở này.
                  </td>
                </tr>
              ) : (
                shifts.map((s) => {
                  const badge = STATUS[s.status];
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setDetailId(s.id)}
                      className="cursor-pointer hover:bg-accent"
                    >
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmt(s.opened_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {s.closed_at ? fmt(s.closed_at) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{vnd(s.opening_float_vnd)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.closing_counted_vnd === null ? '—' : vnd(s.closing_counted_vnd)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <VarianceCell value={s.variance_vnd} />
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      {canReconcile && (
                        <td className="px-3 py-2">
                          {s.status === 'OPEN' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCloseTarget(s);
                              }}
                            >
                              Đóng ca
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {openDialog && (
        <OpenShiftDialog propertyId={propertyId} onClose={() => setOpenDialog(false)} />
      )}
      {closeTarget && (
        <CloseShiftDialog shift={closeTarget} onClose={() => setCloseTarget(null)} />
      )}
      {detailId && <ShiftDetailDialog id={detailId} onClose={() => setDetailId(null)} />}
    </PageContainer>
  );
}

// ── Mở ca ──────────────────────────────────────────────────────────────────
const OpenFormSchema = z.object({
  opening_float_vnd: z.number().int().min(0, 'Tiền đầu ca phải ≥ 0'),
  note: z.string().max(2000).optional(),
});
type OpenFormValues = z.infer<typeof OpenFormSchema>;

/**
 * Dialog "Mở ca". Idempotency-Key sinh 1 LẦN lúc dialog mở (useState lazy init) và tái
 * dùng cho mọi lần submit của dialog → retry mạng replay đúng, KHÔNG tạo ca trùng.
 */
function OpenShiftDialog({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const open = useOpenShift();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const form = useForm<OpenFormValues>({
    resolver: zodResolver(OpenFormSchema),
    defaultValues: { opening_float_vnd: 0, note: '' },
  });

  const onSubmit = async (values: OpenFormValues) => {
    try {
      await open.mutateAsync({
        body: {
          property_id: propertyId,
          opening_float_vnd: values.opening_float_vnd,
          note: values.note || undefined,
        },
        idempotencyKey,
      });
      toast.success('Đã mở ca');
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.body?.code === 'SHIFT_ALREADY_OPEN') {
        toast.error('Cơ sở đang có ca mở');
        void qc.invalidateQueries({ queryKey: ['shifts'] });
        onClose();
      } else {
        toast.error(err instanceof ApiClientError ? err.message : 'Mở ca thất bại');
      }
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mở ca</DialogTitle>
          <DialogDescription>Ghi tiền lẻ/vốn đầu ca để bắt đầu ca thu ngân.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <FormField
              control={form.control}
              name="opening_float_vnd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tiền đầu ca</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      {...field}
                      value={Number.isNaN(field.value) ? '' : field.value}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ghi chú (tuỳ chọn)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="VD ca sáng — lễ tân A" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={open.isPending}>
                {open.isPending ? 'Đang mở…' : 'Mở ca'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Đóng ca ────────────────────────────────────────────────────────────────
const CloseFormSchema = z.object({
  closing_counted_vnd: z.number().int().min(0, 'Tiền đếm cuối ca phải ≥ 0'),
  note: z.string().max(2000).optional(),
});
type CloseFormValues = z.infer<typeof CloseFormSchema>;

/** Dialog "Đóng ca" — If-Match=version (optimistic). Conflict/stale → báo tải lại + invalidate. */
function CloseShiftDialog({ shift, onClose }: { shift: ShiftResponse; onClose: () => void }) {
  const qc = useQueryClient();
  const close = useCloseShift();
  const form = useForm<CloseFormValues>({
    resolver: zodResolver(CloseFormSchema),
    defaultValues: { closing_counted_vnd: 0, note: '' },
  });

  const onSubmit = async (values: CloseFormValues) => {
    try {
      await close.mutateAsync({
        id: shift.id,
        version: shift.version,
        body: { closing_counted_vnd: values.closing_counted_vnd, note: values.note || undefined },
      });
      toast.success('Đã đóng ca');
      onClose();
    } catch (err) {
      const code = err instanceof ApiClientError ? err.body?.code : undefined;
      if (code === 'VERSION_CONFLICT' || code === 'SHIFT_NOT_OPEN') {
        toast.error('Ca đã thay đổi — đang tải lại, thử lại sau');
        void qc.invalidateQueries({ queryKey: ['shifts'] });
        onClose();
      } else {
        toast.error(err instanceof ApiClientError ? err.message : 'Đóng ca thất bại');
      }
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đóng ca</DialogTitle>
          <DialogDescription>
            Đếm tiền mặt thực tế cuối ca — hệ thống tự tính chênh lệch với kỳ vọng.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <FormField
              control={form.control}
              name="closing_counted_vnd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tiền đếm cuối ca</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      {...field}
                      value={Number.isNaN(field.value) ? '' : field.value}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ghi chú (tuỳ chọn)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="VD bàn giao ca chiều" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={close.isPending}>
                {close.isPending ? 'Đang đóng…' : 'Đóng ca'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Chi tiết ca ──────────────────────────────────────────────────────────────
function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums font-medium ${className ?? ''}`}>{value}</dd>
    </div>
  );
}

/** Dialog chi tiết ca: các mốc tiền + danh sách payment CASH thu trong cửa sổ ca. */
function ShiftDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: shift, isLoading } = useShift(id);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chi tiết ca</DialogTitle>
          <DialogDescription>Các mốc tiền của ca và payment tiền mặt thu trong ca.</DialogDescription>
        </DialogHeader>

        {isLoading || !shift ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-4">
            <dl className="grid grid-cols-2 gap-3">
              <Metric label="Tiền đầu ca" value={vnd(shift.opening_float_vnd)} />
              <Metric
                label="Đếm cuối ca"
                value={shift.closing_counted_vnd === null ? '—' : vnd(shift.closing_counted_vnd)}
              />
              <Metric
                label="Tiền kỳ vọng"
                value={shift.expected_cash_vnd === null ? '—' : vnd(shift.expected_cash_vnd)}
              />
              <Metric
                label="Chênh lệch"
                value={shift.variance_vnd === null ? '—' : vnd(shift.variance_vnd)}
                className={shift.variance_vnd !== null && shift.variance_vnd < 0 ? 'text-destructive' : undefined}
              />
            </dl>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                Payment tiền mặt trong ca
              </div>
              {shift.cash_payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Không có payment tiền mặt trong ca.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border/60">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Thời điểm</th>
                        <th className="px-3 py-1.5 text-right font-medium">Số tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {shift.cash_payments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                            {fmt(p.received_at ?? p.created_at)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{vnd(p.amount_vnd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
