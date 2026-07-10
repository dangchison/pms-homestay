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
  Textarea,
  toast,
} from '@pms/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ExpenseTypeSchema, RecurrencePatternSchema, type ExpenseResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { vnd } from '@/lib/format';
import {
  useCreateExpense,
  useDeleteExpense,
  useExpenses,
  useUpdateExpense,
} from '@/lib/hooks/use-expenses';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';

const TYPE_LABEL: Record<string, string> = {
  RENT_LANDLORD: 'Thuê nhà (chủ)',
  ELECTRICITY: 'Điện',
  WATER: 'Nước',
  INTERNET: 'Internet',
  GAS: 'Gas',
  AMENITIES: 'Đồ tiếp khách',
  CLEANING_SUPPLIES: 'Vật tư vệ sinh',
  STAFF_SALARY: 'Lương nhân viên',
  MAINTENANCE: 'Bảo trì',
  MARKETING: 'Marketing',
  OTA_COMMISSION: 'Hoa hồng OTA',
  PLATFORM_FEE: 'Phí nền tảng',
  TAX: 'Thuế',
  OTHER: 'Khác',
};
const RECURRENCE_LABEL: Record<string, string> = {
  MONTHLY: 'Hàng tháng',
  QUARTERLY: 'Hàng quý',
  YEARLY: 'Hàng năm',
};
// OTA_COMMISSION do hệ thống tự sinh khi check-out → KHÔNG cho nhập tay.
const CREATE_TYPES = ExpenseTypeSchema.options.filter((t) => t !== 'OTA_COMMISSION');

const VN_DATE = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDate = (iso: string | null) => (iso ? VN_DATE.format(new Date(iso)) : '—');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Task 2.5 /expenses — Chi phí vận hành (docs/19 §3 Đợt 2). */
export default function ExpensesPage() {
  const propertyId = usePropertyStore((s) => s.selectedId);
  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Chi phí" />
        <p className="text-sm text-muted-foreground">Chọn cơ sở để xem chi phí.</p>
      </PageContainer>
    );
  }
  return <ExpensesView propertyId={propertyId} />;
}

function ExpensesView({ propertyId }: { propertyId: string }) {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExpenseResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseResponse | null>(null);

  const { data, isLoading, isError, error } = useExpenses(propertyId, {
    expense_type: typeFilter === 'ALL' ? undefined : typeFilter,
    from: from || undefined,
    to: to || undefined,
  });
  const rows = data?.data ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Chi phí"
        description="Chi phí vận hành theo cơ sở (điện nước, lương, bảo trì…). Hoa hồng OTA do hệ thống tự ghi khi khách trả phòng."
        action={<Button onClick={() => setCreateOpen(true)}>Thêm chi phí</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả loại</SelectItem>
            {ExpenseTypeSchema.options.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABEL[t] ?? t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none"
          aria-label="Từ ngày"
        />
        <span className="text-sm text-muted-foreground">→</span>
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none"
          aria-label="Đến ngày"
        />
      </div>

      {isError ? (
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiClientError && error.status === 403
            ? 'Bạn không có quyền xem chi phí.'
            : 'Không tải được danh sách chi phí. Thử lại sau.'}
        </p>
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Ngày chi</th>
                <th className="px-3 py-2 font-medium">Loại</th>
                <th className="px-3 py-2 font-medium">Mô tả</th>
                <th className="px-3 py-2 text-right font-medium">Số tiền</th>
                <th className="px-3 py-2 font-medium">Thanh toán</th>
                <th className="px-3 py-2 font-medium">Định kỳ</th>
                <th className="px-3 py-2 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Chưa có chi phí nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                rows.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDate(e.expense_date)}</td>
                    <td className="px-3 py-2">{TYPE_LABEL[e.expense_type] ?? e.expense_type}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.description ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{vnd(e.amount_vnd)}</td>
                    <td className="px-3 py-2">
                      {e.is_paid ? (
                        <Badge variant="secondary">Đã trả</Badge>
                      ) : (
                        <Badge variant="outline">Chưa trả</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.is_recurring
                        ? (RECURRENCE_LABEL[e.recurrence_pattern ?? ''] ?? 'Định kỳ')
                        : e.parent_expense_id
                          ? 'Tự sinh'
                          : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditTarget(e)}>
                          Sửa
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(e)}
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

      {createOpen && <CreateExpenseDialog propertyId={propertyId} onClose={() => setCreateOpen(false)} />}
      {editTarget && <EditExpenseDialog expense={editTarget} onClose={() => setEditTarget(null)} />}
      {deleteTarget && (
        <DeleteExpenseDialog expense={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </PageContainer>
  );
}

// ── Tạo chi phí ──────────────────────────────────────────────────────────────
const CreateSchema = z
  .object({
    expense_type: ExpenseTypeSchema,
    amount_vnd: z.number().int().positive('Số tiền phải lớn hơn 0'),
    expense_date: z.string().min(1, 'Chọn ngày chi'),
    due_date: z.string().optional(),
    description: z.string().max(500).optional(),
    is_recurring: z.boolean(),
    recurrence_pattern: RecurrencePatternSchema.optional(),
    is_paid: z.boolean(),
  })
  .refine((d) => !d.is_recurring || d.recurrence_pattern != null, {
    message: 'Chọn chu kỳ cho chi phí định kỳ',
    path: ['recurrence_pattern'],
  });
type CreateValues = z.infer<typeof CreateSchema>;

function CreateExpenseDialog({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const create = useCreateExpense();
  const form = useForm<CreateValues>({
    resolver: zodResolver(CreateSchema),
    defaultValues: {
      expense_type: 'OTHER',
      amount_vnd: 0,
      expense_date: todayISO(),
      due_date: '',
      description: '',
      is_recurring: false,
      recurrence_pattern: undefined,
      is_paid: false,
    },
  });
  const isRecurring = form.watch('is_recurring');

  const onSubmit = async (values: CreateValues) => {
    try {
      await create.mutateAsync({
        property_id: propertyId,
        expense_type: values.expense_type,
        amount_vnd: values.amount_vnd,
        expense_date: values.expense_date,
        due_date: values.due_date || undefined,
        description: values.description || undefined,
        is_recurring: values.is_recurring,
        recurrence_pattern: values.is_recurring ? values.recurrence_pattern : undefined,
        is_paid: values.is_paid,
      });
      toast.success('Đã thêm chi phí');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Thêm chi phí thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thêm chi phí</DialogTitle>
          <DialogDescription>Ghi một khoản chi phí vận hành cho cơ sở.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <FormField
              control={form.control}
              name="expense_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loại chi phí</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CREATE_TYPES.map((t) => (
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
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="amount_vnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Số tiền (₫)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
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
                name="expense_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ngày chi</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mô tả (tuỳ chọn)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="VD tiền điện tháng 6" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex flex-wrap items-center gap-6">
              <FormField
                control={form.control}
                name="is_paid"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-center gap-2 text-sm">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(c) => field.onChange(c === true)}
                        />
                      </FormControl>
                      Đã thanh toán
                    </label>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="is_recurring"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-center gap-2 text-sm">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(c) => field.onChange(c === true)}
                        />
                      </FormControl>
                      Chi phí định kỳ
                    </label>
                  </FormItem>
                )}
              />
            </div>
            {isRecurring && (
              <FormField
                control={form.control}
                name="recurrence_pattern"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chu kỳ</FormLabel>
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn chu kỳ" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RecurrencePatternSchema.options.map((r) => (
                          <SelectItem key={r} value={r}>
                            {RECURRENCE_LABEL[r] ?? r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
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

// ── Sửa chi phí (PATCH — không đổi loại/định kỳ) ──────────────────────────────
const EditSchema = z.object({
  amount_vnd: z.number().int().positive('Số tiền phải lớn hơn 0'),
  expense_date: z.string().min(1, 'Chọn ngày chi'),
  due_date: z.string().optional(),
  description: z.string().max(500).optional(),
  is_paid: z.boolean(),
});
type EditValues = z.infer<typeof EditSchema>;

function EditExpenseDialog({ expense, onClose }: { expense: ExpenseResponse; onClose: () => void }) {
  const update = useUpdateExpense();
  const form = useForm<EditValues>({
    resolver: zodResolver(EditSchema),
    defaultValues: {
      amount_vnd: expense.amount_vnd,
      expense_date: expense.expense_date,
      due_date: expense.due_date ?? '',
      description: expense.description ?? '',
      is_paid: expense.is_paid,
    },
  });

  const onSubmit = async (values: EditValues) => {
    try {
      await update.mutateAsync({
        id: expense.id,
        body: {
          amount_vnd: values.amount_vnd,
          expense_date: values.expense_date,
          due_date: values.due_date || null,
          description: values.description || null,
          is_paid: values.is_paid,
        },
      });
      toast.success('Đã cập nhật chi phí');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Cập nhật thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sửa chi phí</DialogTitle>
          <DialogDescription>
            {TYPE_LABEL[expense.expense_type] ?? expense.expense_type} — sửa số tiền/ngày/mô tả/thanh toán.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="amount_vnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Số tiền (₫)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
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
                name="expense_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ngày chi</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mô tả (tuỳ chọn)</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_paid"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-2 text-sm">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    </FormControl>
                    Đã thanh toán
                  </label>
                </FormItem>
              )}
            />
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

// ── Xoá chi phí ──────────────────────────────────────────────────────────────
function DeleteExpenseDialog({ expense, onClose }: { expense: ExpenseResponse; onClose: () => void }) {
  const del = useDeleteExpense();

  const onConfirm = async () => {
    try {
      await del.mutateAsync(expense.id);
      toast.success('Đã xoá chi phí');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Xoá thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xoá chi phí?</DialogTitle>
          <DialogDescription>
            Xoá khoản {TYPE_LABEL[expense.expense_type] ?? expense.expense_type} {vnd(expense.amount_vnd)}{' '}
            ngày {fmtDate(expense.expense_date)}. Không thể hoàn tác.
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
