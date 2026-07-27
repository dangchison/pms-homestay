'use client';

import { useState } from 'react';
import {
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
  FormDescription,
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
import type {
  CreateRatePlanRuleRequest,
  PriceModifierType,
  RatePlanResponse,
  RatePlanRuleResponse,
  RatePlanRuleType,
  UpdateRatePlanRuleRequest,
} from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import {
  useCreateRatePlanRule,
  useDeleteRatePlanRule,
  useRatePlanRules,
  useUpdateRatePlanRule,
} from '@/lib/hooks/use-rate-plans';
import { bpToPercent, formatVnd, percentToBp } from '@/lib/rate-plan-format';

const RULE_TYPES: { value: RatePlanRuleType; label: string; hint: string }[] = [
  { value: 'WEEKDAY', label: 'Ngày trong tuần', hint: 'Chọn các thứ áp dụng.' },
  { value: 'WEEKEND', label: 'Cuối tuần', hint: 'Áp cho thứ Bảy và Chủ nhật.' },
  { value: 'HOLIDAY', label: 'Ngày lễ', hint: 'Theo danh sách lễ Việt Nam có sẵn.' },
  { value: 'SEASON', label: 'Mùa', hint: 'Áp trong khoảng ngày.' },
  { value: 'DATE_RANGE', label: 'Khoảng ngày cụ thể', hint: 'Áp đúng khoảng ngày đã chọn.' },
];
const RULE_TYPE_LABEL = Object.fromEntries(RULE_TYPES.map((r) => [r.value, r.label])) as Record<
  RatePlanRuleType,
  string
>;

const MODIFIER_TYPES: { value: PriceModifierType; label: string }[] = [
  { value: 'PERCENT', label: 'Tăng/giảm theo %' },
  { value: 'FIXED', label: 'Cộng/trừ số tiền' },
  { value: 'OVERRIDE', label: 'Đặt giá cố định' },
];

const DOW = [
  { value: 1, label: 'T2' },
  { value: 2, label: 'T3' },
  { value: 3, label: 'T4' },
  { value: 4, label: 'T5' },
  { value: 5, label: 'T6' },
  { value: 6, label: 'T7' },
  { value: 0, label: 'CN' },
];

const numSigned = z
  .string()
  .refine((s) => s.trim() !== '' && Number.isFinite(Number(s)), 'Bắt buộc, phải là số');

const FormSchema = z
  .object({
    rule_type: z.enum(['WEEKDAY', 'WEEKEND', 'HOLIDAY', 'SEASON', 'DATE_RANGE']),
    start_date: z.string(),
    end_date: z.string(),
    days_of_week: z.array(z.number().int().min(0).max(6)),
    price_modifier_type: z.enum(['FIXED', 'PERCENT', 'OVERRIDE']),
    price_modifier_value: numSigned,
    priority: z.string().refine((s) => s.trim() === '' || Number.isInteger(Number(s)), 'Phải là số nguyên'),
    notes: z.string().max(255),
  })
  .refine((d) => !d.start_date || !d.end_date || d.end_date >= d.start_date, {
    message: 'Ngày kết thúc phải từ ngày bắt đầu trở đi',
    path: ['end_date'],
  })
  .refine((d) => d.price_modifier_type !== 'OVERRIDE' || Number(d.price_modifier_value) >= 0, {
    message: 'Giá cố định phải ≥ 0',
    path: ['price_modifier_value'],
  })
  .refine((d) => d.rule_type !== 'WEEKDAY' || d.days_of_week.length > 0, {
    message: 'Chọn ít nhất một thứ',
    path: ['days_of_week'],
  })
  .refine((d) => !['SEASON', 'DATE_RANGE'].includes(d.rule_type) || d.start_date !== '', {
    message: 'Bắt buộc với luật theo khoảng ngày',
    path: ['start_date'],
  });

type FormValues = z.infer<typeof FormSchema>;

const EMPTY: FormValues = {
  rule_type: 'WEEKEND',
  start_date: '',
  end_date: '',
  days_of_week: [],
  price_modifier_type: 'PERCENT',
  price_modifier_value: '',
  priority: '',
  notes: '',
};

function toForm(rule: RatePlanRuleResponse): FormValues {
  return {
    rule_type: rule.rule_type,
    start_date: rule.start_date?.slice(0, 10) ?? '',
    end_date: rule.end_date?.slice(0, 10) ?? '',
    days_of_week: rule.days_of_week ?? [],
    price_modifier_type: rule.price_modifier_type,
    // PERCENT lưu basis point (1500) → hiện 15.
    price_modifier_value:
      rule.price_modifier_type === 'PERCENT'
        ? String(bpToPercent(rule.price_modifier_value))
        : String(rule.price_modifier_value),
    priority: String(rule.priority),
    notes: rule.notes ?? '',
  };
}

/** Mô tả tác động của luật thành chuỗi đọc được. */
function describeModifier(type: PriceModifierType, value: number): string {
  if (type === 'OVERRIDE') return `= ${formatVnd(value)}`;
  if (type === 'PERCENT') {
    const pct = bpToPercent(value);
    return `${pct >= 0 ? '+' : ''}${pct}%`;
  }
  return `${value >= 0 ? '+' : '−'}${formatVnd(Math.abs(value))}`;
}

/** Dialog quản lý luật giá của một gói (mùa / cuối tuần / ngày lễ). */
export function RatePlanRulesDialog({
  plan,
  onClose,
}: {
  plan: RatePlanResponse;
  onClose: () => void;
}) {
  const { data: rules, isLoading } = useRatePlanRules(plan.id);
  const create = useCreateRatePlanRule(plan.id);
  const update = useUpdateRatePlanRule(plan.id);
  const del = useDeleteRatePlanRule(plan.id);

  const [editing, setEditing] = useState<RatePlanRuleResponse | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema), defaultValues: EMPTY });
  const ruleType = form.watch('rule_type');
  const modifierType = form.watch('price_modifier_type');
  const needsDates = ruleType === 'SEASON' || ruleType === 'DATE_RANGE';

  const openCreate = () => {
    setEditing(null);
    form.reset(EMPTY);
    setFormOpen(true);
  };
  const openEdit = (rule: RatePlanRuleResponse) => {
    setEditing(rule);
    form.reset(toForm(rule));
    setFormOpen(true);
  };

  const onSubmit = async (v: FormValues) => {
    const value =
      v.price_modifier_type === 'PERCENT'
        ? percentToBp(Number(v.price_modifier_value))
        : Number(v.price_modifier_value);

    const shared = {
      rule_type: v.rule_type,
      price_modifier_type: v.price_modifier_type,
      price_modifier_value: value,
      ...(v.priority.trim() === '' ? {} : { priority: Number(v.priority) }),
    };

    try {
      if (editing) {
        const body: UpdateRatePlanRuleRequest = {
          ...shared,
          start_date: v.start_date === '' ? null : v.start_date,
          end_date: v.end_date === '' ? null : v.end_date,
          days_of_week: v.rule_type === 'WEEKDAY' ? v.days_of_week : null,
          notes: v.notes === '' ? null : v.notes,
        };
        await update.mutateAsync({ ruleId: editing.id, ...body });
        toast.success('Đã cập nhật luật giá');
      } else {
        const body: CreateRatePlanRuleRequest = {
          ...shared,
          ...(v.start_date === '' ? {} : { start_date: v.start_date }),
          ...(v.end_date === '' ? {} : { end_date: v.end_date }),
          ...(v.rule_type === 'WEEKDAY' ? { days_of_week: v.days_of_week } : {}),
          ...(v.notes === '' ? {} : { notes: v.notes }),
        };
        await create.mutateAsync(body);
        toast.success('Đã thêm luật giá');
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      // 422 hay gặp nhất: hai luật cùng độ ưu tiên chồng khoảng ngày (BE chặn).
      toast.error(err instanceof ApiClientError ? err.message : 'Lưu luật giá thất bại');
    }
  };

  const onDelete = (rule: RatePlanRuleResponse) =>
    del.mutate(rule.id, {
      onSuccess: () => toast.success('Đã xoá luật giá'),
      onError: (err) =>
        toast.error(err instanceof ApiClientError ? err.message : 'Xoá luật giá thất bại'),
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Luật giá — {plan.name}</DialogTitle>
          <DialogDescription>
            Luật áp lên giá cơ bản {formatVnd(plan.base_price_vnd)}. Độ ưu tiên cao hơn thắng khi
            nhiều luật cùng rơi vào một ngày; đặt giá cố định luôn thắng tuyệt đối.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Loại</th>
                  <th className="px-3 py-2 font-medium">Phạm vi</th>
                  <th className="px-3 py-2 font-medium">Tác động</th>
                  <th className="px-3 py-2 font-medium">Ưu tiên</th>
                  <th className="px-3 py-2 font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {(rules ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      Chưa có luật nào — mọi ngày dùng giá cơ bản.
                    </td>
                  </tr>
                ) : (
                  (rules ?? []).map((rule) => (
                    <tr key={rule.id}>
                      <td className="px-3 py-2 font-medium">{RULE_TYPE_LABEL[rule.rule_type]}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {rule.days_of_week?.length
                          ? rule.days_of_week
                              .map((d) => DOW.find((x) => x.value === d)?.label ?? d)
                              .join(', ')
                          : rule.start_date
                            ? `${rule.start_date}${rule.end_date ? ` → ${rule.end_date}` : ''}`
                            : '—'}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {describeModifier(rule.price_modifier_type, rule.price_modifier_value)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{rule.priority}</td>
                      <td className="flex gap-2 px-3 py-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(rule)}>
                          Sửa
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={del.isPending}
                          onClick={() => onDelete(rule)}
                        >
                          Xoá
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!formOpen ? (
          <div className="flex justify-end">
            <Button onClick={openCreate}>Thêm luật giá</Button>
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-3 rounded-md border border-border p-3"
              noValidate
            >
              <p className="text-sm font-medium">{editing ? 'Sửa luật' : 'Luật mới'}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="rule_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loại luật</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger aria-label="Loại luật">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {RULE_TYPES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {RULE_TYPES.find((r) => r.value === ruleType)?.hint}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Độ ưu tiên</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="numeric" placeholder="0" {...field} />
                      </FormControl>
                      <FormDescription>
                        Bỏ trống = mặc định. Hai luật cùng độ ưu tiên không được chồng khoảng ngày.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {ruleType === 'WEEKDAY' && (
                <FormField
                  control={form.control}
                  name="days_of_week"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Áp dụng các thứ</FormLabel>
                      <div className="flex flex-wrap gap-3 rounded-md border border-border p-3">
                        {DOW.map((d) => (
                          <label key={d.value} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={field.value.includes(d.value)}
                              onCheckedChange={(c) =>
                                field.onChange(
                                  c === true
                                    ? [...field.value, d.value]
                                    : field.value.filter((x) => x !== d.value),
                                )
                              }
                            />
                            {d.label}
                          </label>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {needsDates && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="start_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Từ ngày</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="end_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Đến ngày</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="price_modifier_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cách áp giá</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger aria-label="Cách áp giá">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MODIFIER_TYPES.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
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
                  name="price_modifier_value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {modifierType === 'PERCENT'
                          ? 'Mức thay đổi (%)'
                          : modifierType === 'OVERRIDE'
                            ? 'Giá cố định (₫)'
                            : 'Mức thay đổi (₫)'}
                      </FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="numeric" {...field} />
                      </FormControl>
                      <FormDescription>
                        {modifierType === 'OVERRIDE'
                          ? 'Thay thế hoàn toàn giá cơ bản.'
                          : 'Số âm để giảm giá, ví dụ −10.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ghi chú</FormLabel>
                    <FormControl>
                      <Input placeholder="VD Cao điểm hè" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFormOpen(false);
                    setEditing(null);
                  }}
                >
                  Hủy
                </Button>
                <Button type="submit" disabled={create.isPending || update.isPending}>
                  {create.isPending || update.isPending
                    ? 'Đang lưu…'
                    : editing
                      ? 'Lưu luật'
                      : 'Thêm luật'}
                </Button>
              </div>
            </form>
          </Form>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
