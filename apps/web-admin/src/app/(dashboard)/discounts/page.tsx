'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@pms/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DiscountTypeSchema, type DiscountCodeResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { bpToPct, formatDiscountValue, pctToBp } from '@/lib/discount-format';
import {
  useCreateDiscount,
  useDeleteDiscount,
  useDiscounts,
  useUpdateDiscount,
} from '@/lib/hooks/use-discounts';
import { PageContainer, PageHeader } from '@/components/layout/page';

const TYPE_LABEL: Record<string, string> = { PERCENT: 'Phần trăm (%)', FIXED: 'Tiền cố định (₫)' };

const VN_DATE = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDate = (iso: string | null) => (iso ? VN_DATE.format(new Date(iso)) : '—');

/** applicable_property_ids: NULL = mọi cơ sở; [] = không cơ sở nào; mảng = số cơ sở. */
function scopeLabel(ids: string[] | null): string {
  if (ids === null) return 'Mọi cơ sở';
  if (ids.length === 0) return 'Không cơ sở';
  return `${ids.length} cơ sở`;
}
/** used_count/max_uses — max_uses null = không giới hạn (∞). */
function usageLabel(used: number, max: number | null): string {
  return `${used}/${max ?? '∞'}`;
}
function validityLabel(from: string | null, to: string | null): string {
  if (!from && !to) return 'Không giới hạn';
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

/** Task 2.2 /discounts — Mã giảm giá (docs/19 §3 Đợt 2). Tài nguyên tenant-global (không chọn cơ sở). */
export default function DiscountsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DiscountCodeResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DiscountCodeResponse | null>(null);

  const { data, isLoading, isError, error } = useDiscounts();
  const rows = data ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Mã giảm giá"
        description="Voucher áp vào báo giá khi tạo booking. Giảm theo % hoặc số tiền cố định; áp cho mọi cơ sở của bạn."
        action={<Button onClick={() => setCreateOpen(true)}>Thêm mã</Button>}
      />

      {isError ? (
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiClientError && error.status === 403
            ? 'Bạn không có quyền quản lý mã giảm giá.'
            : 'Không tải được danh sách mã giảm giá. Thử lại sau.'}
        </p>
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Mã</th>
                <th className="px-3 py-2 font-medium">Giá trị</th>
                <th className="px-3 py-2 font-medium">Phạm vi</th>
                <th className="px-3 py-2 font-medium">Lượt dùng</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 font-medium">Hiệu lực</th>
                <th className="px-3 py-2 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Chưa có mã giảm giá nào. Bấm “Thêm mã” để tạo.
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 font-medium">{d.code}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatDiscountValue(d.discount_type, d.discount_value)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {scopeLabel(d.applicable_property_ids)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{usageLabel(d.used_count, d.max_uses)}</td>
                    <td className="px-3 py-2">
                      {d.is_active ? (
                        <Badge variant="secondary">Đang bật</Badge>
                      ) : (
                        <Badge variant="outline">Tắt</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {validityLabel(d.valid_from, d.valid_to)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditTarget(d)}>
                          Sửa
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(d)}
                        >
                          Xoá
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && <CreateDiscountDialog onClose={() => setCreateOpen(false)} />}
      {editTarget && <EditDiscountDialog discount={editTarget} onClose={() => setEditTarget(null)} />}
      {deleteTarget && (
        <DeleteDiscountDialog discount={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </PageContainer>
  );
}

// ── Schema form (giá trị nhập THEO ĐƠN VỊ HIỂN THỊ: % cho PERCENT, ₫ cho FIXED) ──────
// Refine khớp refineDiscountValue (shared-types) SAU khi quy đổi: PERCENT % 0..100 →
// bp 0..10000; FIXED VND ≥ 1. Quy đổi bp thực hiện lúc submit (pctToBp).
const DiscountFormSchema = z
  .object({
    code: z.string().max(64),
    discount_type: DiscountTypeSchema,
    value: z.number(),
    is_active: z.boolean(),
  })
  .refine((d) => d.code.trim().length >= 1, { message: 'Nhập mã giảm giá', path: ['code'] })
  .refine(
    (d) =>
      d.discount_type === 'PERCENT'
        ? d.value >= 0 && d.value <= 100
        : Number.isInteger(d.value) && d.value >= 1,
    { message: 'PERCENT: nhập 0–100 (%); FIXED: số tiền ≥ 1 (₫)', path: ['value'] },
  );
type DiscountFormValues = z.infer<typeof DiscountFormSchema>;

/** Ô nhập chung cho tạo/sửa: Mã, Loại, Giá trị (đơn vị đổi theo loại), Đang áp dụng. */
function DiscountFields({ form }: { form: ReturnType<typeof useForm<DiscountFormValues>> }) {
  const type = form.watch('discount_type');
  return (
    <>
      <FormField
        control={form.control}
        name="code"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Mã giảm giá</FormLabel>
            <FormControl>
              <Input placeholder="VD SUMMER10" className="uppercase" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="discount_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Loại</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {DiscountTypeSchema.options.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="value"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{type === 'PERCENT' ? 'Giá trị (%)' : 'Số tiền (₫)'}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={type === 'PERCENT' ? 0 : 1}
                  max={type === 'PERCENT' ? 100 : undefined}
                  step={type === 'PERCENT' ? 'any' : 1}
                  {...field}
                  value={Number.isNaN(field.value) ? '' : field.value}
                  onChange={(e) => field.onChange(e.target.valueAsNumber)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="is_active"
        render={({ field }) => (
          <FormItem>
            <label className="flex items-center gap-2 text-sm">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />
              </FormControl>
              Đang áp dụng
            </label>
          </FormItem>
        )}
      />
    </>
  );
}

// ── Tạo mã ───────────────────────────────────────────────────────────────────
function CreateDiscountDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateDiscount();
  const form = useForm<DiscountFormValues>({
    resolver: zodResolver(DiscountFormSchema),
    defaultValues: { code: '', discount_type: 'PERCENT', value: 0, is_active: true },
  });

  const onSubmit = async (values: DiscountFormValues) => {
    try {
      await create.mutateAsync({
        code: values.code.trim().toUpperCase(),
        discount_type: values.discount_type,
        // ⚠️ PERCENT: % → basis-point (×100). FIXED: VND nguyên.
        discount_value: values.discount_type === 'PERCENT' ? pctToBp(values.value) : values.value,
        is_active: values.is_active,
      });
      toast.success('Đã thêm mã giảm giá');
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.body?.code === 'DISCOUNT_CODE_DUPLICATE') {
        form.setError('code', { message: 'Mã đã tồn tại — chọn mã khác' });
        return;
      }
      toast.error(err instanceof ApiClientError ? err.message : 'Thêm mã thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thêm mã giảm giá</DialogTitle>
          <DialogDescription>Mã áp cho mọi cơ sở của bạn khi tạo booking.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <DiscountFields form={form} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Sửa mã ───────────────────────────────────────────────────────────────────
function EditDiscountDialog({
  discount,
  onClose,
}: {
  discount: DiscountCodeResponse;
  onClose: () => void;
}) {
  const update = useUpdateDiscount();
  const form = useForm<DiscountFormValues>({
    resolver: zodResolver(DiscountFormSchema),
    defaultValues: {
      code: discount.code,
      discount_type: discount.discount_type,
      // ⚠️ PERCENT: basis-point → % (÷100) để nạp vào ô; submit ×100 round-trip.
      value:
        discount.discount_type === 'PERCENT'
          ? bpToPct(discount.discount_value)
          : discount.discount_value,
      is_active: discount.is_active,
    },
  });

  const onSubmit = async (values: DiscountFormValues) => {
    try {
      await update.mutateAsync({
        id: discount.id,
        body: {
          code: values.code.trim().toUpperCase(),
          // Gửi CẶP discount_type + discount_value để refine cross-field kiểm được.
          discount_type: values.discount_type,
          discount_value: values.discount_type === 'PERCENT' ? pctToBp(values.value) : values.value,
          is_active: values.is_active,
        },
      });
      toast.success('Đã cập nhật mã giảm giá');
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.body?.code === 'DISCOUNT_CODE_DUPLICATE') {
        form.setError('code', { message: 'Mã đã tồn tại — chọn mã khác' });
        return;
      }
      toast.error(err instanceof ApiClientError ? err.message : 'Cập nhật thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sửa mã giảm giá</DialogTitle>
          <DialogDescription>{discount.code} — sửa mã, loại, giá trị, trạng thái.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <DiscountFields form={form} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Xoá mã ───────────────────────────────────────────────────────────────────
function DeleteDiscountDialog({
  discount,
  onClose,
}: {
  discount: DiscountCodeResponse;
  onClose: () => void;
}) {
  const del = useDeleteDiscount();

  const onConfirm = async () => {
    try {
      await del.mutateAsync(discount.id);
      toast.success('Đã xoá mã giảm giá');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Xoá thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xoá mã giảm giá?</DialogTitle>
          <DialogDescription>
            Xoá mã <span className="font-medium">{discount.code}</span>. Mã sẽ ngừng áp dụng cho
            báo giá mới. Không thể hoàn tác.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="destructive" disabled={del.isPending} onClick={onConfirm}>
            {del.isPending ? 'Đang xoá…' : 'Xoá'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
