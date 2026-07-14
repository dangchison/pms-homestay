'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  cn,
  toast,
} from '@pms/ui';
import { Loader2, Lock, LockOpen, Wallet } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiClientError } from '@/lib/api-client';
import { useCloseShift, useOpenShift } from '@/lib/hooks/use-shift';
import { useSelectedProperty } from '@/lib/hooks/use-properties';
import { useOnlineStatus } from '@/hooks/useOfflineCache';
import { useAuthStore } from '@/stores/auth.store';
import { useShiftStore, type OpenShiftLocal } from '@/stores/shift.store';
import { hhmm, vnd } from '@/lib/format';

const AmountSchema = z.object({ amount: z.number().int().min(0, 'Số tiền không hợp lệ') });
type AmountValues = z.infer<typeof AmountSchema>;

/** Lệch state khi đóng ca → xoá cục bộ + đồng bộ lại (cho phép mở lại). */
const CLOSE_DESYNC_CODES = new Set(['VERSION_CONFLICT', 'SHIFT_NOT_OPEN', 'SHIFT_NOT_FOUND']);

/**
 * Card "Ca thu ngân" trên trang Cá nhân (task 2.10b, docs/16 #10). CHỈ hiện với STAFF
 * (thu ngân) — vai khác tự ẩn. Nguồn "đang có ca mở?" là store cục bộ (localStorage),
 * KHÔNG GET /shifts (STAFF thiếu report.financial). Mở/đóng ca là thao tác ghi → cần online.
 */
export function ShiftCard() {
  const role = useAuthStore((s) => s.user?.role);
  const online = useOnlineStatus();
  const { selectedId } = useSelectedProperty();
  const local = useShiftStore((s) => (selectedId ? s.byProperty[selectedId] : undefined));
  const clearOpen = useShiftStore((s) => s.clearOpen);
  const closeShift = useCloseShift();
  const [openDialogShown, setOpenDialogShown] = useState(false);
  const [closeDialogShown, setCloseDialogShown] = useState(false);

  if (role !== 'STAFF') return null;

  // Kết quả đóng ca gần nhất (variance) — chỉ hiện khi chưa mở ca mới ở cơ sở này.
  const closedResult = !local ? closeShift.data : undefined;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Ca thu ngân</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {local ? (
          <>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium text-success">
                <LockOpen className="size-4" />
                Ca đang mở
              </span>
              <span className="text-sm text-muted-foreground">Mở lúc {hhmm(local.openedAt)}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Tiền đầu ca <span className="font-medium text-foreground">{vnd(local.openingFloatVnd)}</span>
            </div>
            <Button
              className="h-11"
              disabled={!online}
              onClick={() => setCloseDialogShown(true)}
            >
              <Lock className="size-4" />
              Đóng ca
            </Button>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Wallet className="size-4" />
              Chưa mở ca
            </span>
            <Button
              className="h-11"
              disabled={!online || !selectedId}
              onClick={() => setOpenDialogShown(true)}
            >
              <LockOpen className="size-4" />
              Mở ca
            </Button>
          </>
        )}

        {closedResult && (
          <div className="grid gap-1 rounded-md border border-border/70 p-3">
            <span className="text-xs text-muted-foreground">Kết quả đóng ca gần nhất</span>
            <div className="flex items-center justify-between">
              <span className="text-sm">Chênh lệch</span>
              <span
                data-testid="shift-variance"
                className={cn(
                  'text-sm font-semibold',
                  (closedResult.variance_vnd ?? 0) === 0 ? 'text-success' : 'text-destructive',
                )}
              >
                {vnd(closedResult.variance_vnd ?? 0)}
              </span>
            </div>
          </div>
        )}
      </CardContent>

      {selectedId && (
        <OpenShiftDialog
          open={openDialogShown}
          onOpenChange={setOpenDialogShown}
          propertyId={selectedId}
        />
      )}
      {selectedId && (
        <CloseShiftDialog
          open={closeDialogShown}
          onOpenChange={setCloseDialogShown}
          propertyId={selectedId}
          local={local}
          closeShift={closeShift}
          clearOpen={clearOpen}
        />
      )}
    </Card>
  );
}

/** Dialog "Mở ca" — nhập Tiền đầu ca, gửi Idempotency-Key. 409 SHIFT_ALREADY_OPEN → toast. */
function OpenShiftDialog({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  propertyId: string;
}) {
  const openShift = useOpenShift();
  // Idempotency-Key sinh 1 LẦN cho mỗi lần mở dialog và KHÔNG đổi giữa các lần submit → khi mất
  // response mạng, lần bấm lại dùng CÙNG key để server replay đúng ca vừa mở (shifts.service.open),
  // tránh 409 SHIFT_ALREADY_OPEN oan. Xoay key mỗi khi đóng dialog: card này mount bền theo
  // selectedId (khác web-admin unmount khi đóng) nên ca kế tiếp cần key riêng, tránh đụng
  // unique (tenant_id, idempotency_key) → 409 sai (uq_cash_shift_idem).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const form = useForm<AmountValues>({ resolver: zodResolver(AmountSchema), defaultValues: { amount: 0 } });

  const closeDialog = () => {
    onOpenChange(false);
    setIdempotencyKey(crypto.randomUUID());
  };

  const onSubmit = async (values: AmountValues) => {
    try {
      await openShift.mutateAsync({
        body: { property_id: propertyId, opening_float_vnd: values.amount },
        idempotencyKey,
      });
      toast.success('Đã mở ca thu ngân');
      form.reset({ amount: 0 });
      closeDialog();
    } catch (err) {
      if (err instanceof ApiClientError && err.body?.code === 'SHIFT_ALREADY_OPEN') {
        toast.error('Cơ sở đang có ca mở — vui lòng liên hệ quản lý để đóng ca hiện tại');
        closeDialog();
        return;
      }
      toast.error(err instanceof ApiClientError ? err.message : 'Mở ca thất bại');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : closeDialog())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mở ca thu ngân</DialogTitle>
          <DialogDescription>Nhập số tiền lẻ/vốn có trong két lúc bắt đầu ca.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tiền đầu ca</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      className="h-12 text-base"
                      {...field}
                      value={Number.isNaN(field.value) ? '' : field.value}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" className="h-12 w-full text-base" disabled={openShift.isPending}>
                {openShift.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Mở ca'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog "Đóng ca" — nhập Tiền đếm thực, gửi If-Match=version. Lỗi lệch state → xoá cục bộ. */
function CloseShiftDialog({
  open,
  onOpenChange,
  propertyId,
  local,
  closeShift,
  clearOpen,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  propertyId: string;
  local: OpenShiftLocal | undefined;
  closeShift: ReturnType<typeof useCloseShift>;
  clearOpen: (propertyId: string) => void;
}) {
  const form = useForm<AmountValues>({ resolver: zodResolver(AmountSchema), defaultValues: { amount: 0 } });

  const onSubmit = async (values: AmountValues) => {
    if (!local) return;
    try {
      await closeShift.mutateAsync({
        shiftId: local.shiftId,
        propertyId,
        version: local.version,
        body: { closing_counted_vnd: values.amount },
      });
      toast.success('Đã đóng ca thu ngân');
      onOpenChange(false);
      form.reset({ amount: 0 });
    } catch (err) {
      const desync =
        err instanceof ApiClientError &&
        (CLOSE_DESYNC_CODES.has(err.body?.code ?? '') || [404, 409, 422].includes(err.status));
      if (desync) {
        clearOpen(propertyId);
        toast.error('Trạng thái ca đã được đồng bộ lại — bạn có thể mở ca mới');
        onOpenChange(false);
        return;
      }
      toast.error(err instanceof ApiClientError ? err.message : 'Đóng ca thất bại');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đóng ca thu ngân</DialogTitle>
          <DialogDescription>Đếm tiền mặt thực tế trong két cuối ca để đối quỹ.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tiền đếm thực</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      className="h-12 text-base"
                      {...field}
                      value={Number.isNaN(field.value) ? '' : field.value}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" className="h-12 w-full text-base" disabled={closeShift.isPending}>
                {closeShift.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Đóng ca'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
