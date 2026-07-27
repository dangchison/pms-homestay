'use client';

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
  toast,
} from '@pms/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type {
  BookingMode,
  CreateRatePlanRequest,
  DepositType,
  RatePlanResponse,
  UpdateRatePlanRequest,
} from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useCreateRatePlan, useUpdateRatePlan } from '@/lib/hooks/use-rate-plans';
import { BP_PER_UNIT, bpToPercent, localDate, percentToBp } from '@/lib/rate-plan-format';

const MODES: { value: BookingMode; label: string; hint: string }[] = [
  { value: 'HOURLY', label: 'Theo giờ', hint: 'Bán theo block giờ, có phụ thu qua đêm.' },
  { value: 'DAILY', label: 'Theo ngày', hint: 'Bán theo đêm, có giờ nhận/trả phòng.' },
  { value: 'MONTHLY', label: 'Theo tháng', hint: 'Cho thuê dài hạn, chốt điện nước hằng tháng.' },
];

const DEPOSIT_TYPES: { value: DepositType; label: string }[] = [
  { value: 'NONE', label: 'Không thu cọc' },
  { value: 'PERCENT', label: 'Theo phần trăm' },
  { value: 'FIXED', label: 'Số tiền cố định' },
];

/**
 * Số nhập từ <Input type="number"> luôn là chuỗi. Giữ nguyên chuỗi trong form rồi
 * quy đổi lúc submit — tránh coerce chuỗi rỗng thành 0 (0 và "bỏ trống" khác nghĩa:
 * bỏ trống = giữ mặc định DB, 0 = miễn phí).
 */
const numOpt = z
  .string()
  .refine((s) => s.trim() === '' || (Number.isFinite(Number(s)) && Number(s) >= 0), 'Số không hợp lệ');
const numReq = z
  .string()
  .refine((s) => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0, 'Bắt buộc, số ≥ 0');
const timeOpt = z
  .string()
  .refine((s) => s.trim() === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(s), 'Định dạng HH:mm');

const FormSchema = z
  .object({
    name: z.string().min(1, 'Bắt buộc').max(255),
    mode: z.enum(['HOURLY', 'DAILY', 'MONTHLY']),
    is_default: z.boolean(),
    effective_from: z.string().min(1, 'Bắt buộc'),
    effective_to: z.string(),
    base_price_vnd: numReq,
    deposit_type: z.enum(['NONE', 'PERCENT', 'FIXED']),
    /** PERCENT: người dùng nhập % (0..100) — quy đổi sang basis point khi gửi. */
    deposit_value: numOpt,
    hourly_base_hours: numOpt,
    hourly_extra_block_minutes: numOpt,
    hourly_extra_block_price_vnd: numOpt,
    hourly_overnight_surcharge_vnd: numOpt,
    hourly_overnight_start: timeOpt,
    hourly_overnight_end: timeOpt,
    daily_checkin_time: timeOpt,
    daily_checkout_time: timeOpt,
    daily_early_checkin_fee_vnd: numOpt,
    daily_late_checkout_fee_vnd: numOpt,
    monthly_includes_utilities: z.boolean(),
    monthly_electricity_per_kwh_vnd: numOpt,
    monthly_water_per_m3_vnd: numOpt,
  })
  .refine((d) => !d.effective_to || d.effective_to > d.effective_from, {
    message: 'Ngày kết thúc phải sau ngày bắt đầu',
    path: ['effective_to'],
  })
  .refine((d) => d.deposit_type !== 'PERCENT' || Number(d.deposit_value || 0) <= 100, {
    message: 'Phần trăm cọc tối đa 100',
    path: ['deposit_value'],
  })
  .refine((d) => d.deposit_type === 'NONE' || d.deposit_value.trim() !== '', {
    message: 'Nhập mức cọc',
    path: ['deposit_value'],
  });

type FormValues = z.infer<typeof FormSchema>;

const num = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s));
const str = (s: string): string | undefined => (s.trim() === '' ? undefined : s);
const show = (n: number | null | undefined): string => (n == null ? '' : String(n));

function toDefaults(plan: RatePlanResponse | null, mode: BookingMode): FormValues {
  if (!plan) {
    return {
      name: '',
      mode,
      is_default: false,
      effective_from: localDate(new Date()),
      effective_to: '',
      base_price_vnd: '',
      deposit_type: 'NONE',
      deposit_value: '',
      hourly_base_hours: '',
      hourly_extra_block_minutes: '',
      hourly_extra_block_price_vnd: '',
      hourly_overnight_surcharge_vnd: '',
      hourly_overnight_start: '',
      hourly_overnight_end: '',
      daily_checkin_time: '',
      daily_checkout_time: '',
      daily_early_checkin_fee_vnd: '',
      daily_late_checkout_fee_vnd: '',
      monthly_includes_utilities: false,
      monthly_electricity_per_kwh_vnd: '',
      monthly_water_per_m3_vnd: '',
    };
  }
  return {
    name: plan.name,
    mode: plan.mode,
    is_default: plan.is_default,
    effective_from: plan.effective_from.slice(0, 10),
    effective_to: plan.effective_to?.slice(0, 10) ?? '',
    base_price_vnd: String(plan.base_price_vnd),
    deposit_type: plan.deposit_type,
    // Cọc PERCENT lưu basis point (3000) → hiện cho người dùng là 30.
    deposit_value:
      plan.deposit_type === 'PERCENT' ? String(bpToPercent(plan.deposit_value)) : String(plan.deposit_value),
    hourly_base_hours: show(plan.hourly_base_hours),
    hourly_extra_block_minutes: show(plan.hourly_extra_block_minutes),
    hourly_extra_block_price_vnd: show(plan.hourly_extra_block_price_vnd),
    hourly_overnight_surcharge_vnd: show(plan.hourly_overnight_surcharge_vnd),
    hourly_overnight_start: plan.hourly_overnight_start?.slice(0, 5) ?? '',
    hourly_overnight_end: plan.hourly_overnight_end?.slice(0, 5) ?? '',
    daily_checkin_time: plan.daily_checkin_time?.slice(0, 5) ?? '',
    daily_checkout_time: plan.daily_checkout_time?.slice(0, 5) ?? '',
    daily_early_checkin_fee_vnd: show(plan.daily_early_checkin_fee_vnd),
    daily_late_checkout_fee_vnd: show(plan.daily_late_checkout_fee_vnd),
    monthly_includes_utilities: plan.monthly_includes_utilities ?? false,
    monthly_electricity_per_kwh_vnd: show(plan.monthly_electricity_per_kwh_vnd),
    monthly_water_per_m3_vnd: show(plan.monthly_water_per_m3_vnd),
  };
}

/** Phần giá chung create/update (mode-specific field chỉ gửi khi đúng mode). */
function toPricingPayload(v: FormValues) {
  const deposit =
    v.deposit_type === 'NONE'
      ? 0
      : v.deposit_type === 'PERCENT'
        ? percentToBp(Number(v.deposit_value))
        : Number(v.deposit_value);

  const base = {
    base_price_vnd: Number(v.base_price_vnd),
    deposit_type: v.deposit_type,
    deposit_value: deposit,
  };

  if (v.mode === 'HOURLY') {
    return {
      ...base,
      hourly_base_hours: num(v.hourly_base_hours),
      hourly_extra_block_minutes: num(v.hourly_extra_block_minutes),
      hourly_extra_block_price_vnd: num(v.hourly_extra_block_price_vnd),
      hourly_overnight_surcharge_vnd: num(v.hourly_overnight_surcharge_vnd),
      hourly_overnight_start: str(v.hourly_overnight_start),
      hourly_overnight_end: str(v.hourly_overnight_end),
    };
  }
  if (v.mode === 'DAILY') {
    return {
      ...base,
      daily_checkin_time: str(v.daily_checkin_time),
      daily_checkout_time: str(v.daily_checkout_time),
      daily_early_checkin_fee_vnd: num(v.daily_early_checkin_fee_vnd),
      daily_late_checkout_fee_vnd: num(v.daily_late_checkout_fee_vnd),
    };
  }
  return {
    ...base,
    monthly_includes_utilities: v.monthly_includes_utilities,
    monthly_electricity_per_kwh_vnd: num(v.monthly_electricity_per_kwh_vnd),
    monthly_water_per_m3_vnd: num(v.monthly_water_per_m3_vnd),
  };
}

/**
 * Dialog tạo/sửa gói giá (tab "Gói giá" trong /properties).
 * `mode` KHÔNG sửa được sau khi tạo — UpdateRatePlanRequestSchema không nhận field này.
 */
export function RatePlanFormDialog({
  propertyId,
  plan,
  defaultMode,
  onClose,
}: {
  propertyId: string;
  plan: RatePlanResponse | null;
  defaultMode: BookingMode;
  onClose: () => void;
}) {
  const create = useCreateRatePlan();
  const update = useUpdateRatePlan();
  const isEdit = plan != null;
  const pending = create.isPending || update.isPending;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(plan, defaultMode),
  });
  const mode = form.watch('mode');
  const depositType = form.watch('deposit_type');

  const onSubmit = async (v: FormValues) => {
    try {
      if (isEdit) {
        const body: UpdateRatePlanRequest = {
          name: v.name,
          is_default: v.is_default,
          effective_from: v.effective_from,
          effective_to: v.effective_to === '' ? null : v.effective_to,
          ...toPricingPayload(v),
        };
        await update.mutateAsync({ id: plan.id, ...body });
        toast.success('Đã cập nhật gói giá');
      } else {
        const body: CreateRatePlanRequest = {
          property_id: propertyId,
          name: v.name,
          mode: v.mode,
          is_default: v.is_default,
          effective_from: v.effective_from,
          ...(v.effective_to === '' ? {} : { effective_to: v.effective_to }),
          ...toPricingPayload(v),
        };
        await create.mutateAsync(body);
        toast.success('Đã tạo gói giá');
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Lưu gói giá thất bại',
      );
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa gói giá' : 'Tạo gói giá'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Sửa gói đang hoạt động sẽ tăng phiên bản gói; báo giá đã cấp trước đó sẽ được tính lại khi tạo đặt phòng.'
              : 'Giá cơ bản áp cho mọi ngày; thêm luật giá sau để phụ thu cuối tuần, ngày lễ hoặc theo mùa.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tên gói</FormLabel>
                    <FormControl>
                      <Input placeholder="VD Giá tiêu chuẩn" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phương thức thuê</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
                      <FormControl>
                        <SelectTrigger aria-label="Phương thức thuê">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MODES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {isEdit
                        ? 'Không đổi được phương thức sau khi tạo.'
                        : MODES.find((m) => m.value === mode)?.hint}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="base_price_vnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Giá cơ bản (₫{mode === 'HOURLY' ? '/block' : mode === 'DAILY' ? '/đêm' : '/tháng'})
                    </FormLabel>
                    <FormControl>
                      <Input type="number" min={0} inputMode="numeric" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="effective_from"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Áp dụng từ</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="effective_to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Đến ngày</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormDescription>Bỏ trống = không giới hạn.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="deposit_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chính sách cọc</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label="Chính sách cọc">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DEPOSIT_TYPES.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {depositType !== 'NONE' && (
                <FormField
                  control={form.control}
                  name="deposit_value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {depositType === 'PERCENT' ? 'Mức cọc (%)' : 'Mức cọc (₫)'}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={depositType === 'PERCENT' ? 100 : undefined}
                          inputMode="numeric"
                          {...field}
                        />
                      </FormControl>
                      {depositType === 'PERCENT' && (
                        <FormDescription>
                          Nhập theo phần trăm, ví dụ 30. Hệ thống lưu {BP_PER_UNIT} cho mỗi 100%.
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {mode === 'HOURLY' && (
              <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
                <legend className="px-1 text-xs font-medium text-muted-foreground">Cấu hình theo giờ</legend>
                <NumField control={form.control} name="hourly_base_hours" label="Số giờ trong block" />
                <NumField control={form.control} name="hourly_extra_block_minutes" label="Block phụ (phút)" />
                <NumField control={form.control} name="hourly_extra_block_price_vnd" label="Giá block phụ (₫)" />
                <NumField
                  control={form.control}
                  name="hourly_overnight_surcharge_vnd"
                  label="Phụ thu qua đêm (₫)"
                />
                <TimeField control={form.control} name="hourly_overnight_start" label="Qua đêm từ" />
                <TimeField control={form.control} name="hourly_overnight_end" label="Qua đêm đến" />
              </fieldset>
            )}

            {mode === 'DAILY' && (
              <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                <legend className="px-1 text-xs font-medium text-muted-foreground">Cấu hình theo ngày</legend>
                <TimeField control={form.control} name="daily_checkin_time" label="Giờ nhận phòng" />
                <TimeField control={form.control} name="daily_checkout_time" label="Giờ trả phòng" />
                <NumField
                  control={form.control}
                  name="daily_early_checkin_fee_vnd"
                  label="Phí nhận sớm (₫)"
                />
                <NumField
                  control={form.control}
                  name="daily_late_checkout_fee_vnd"
                  label="Phí trả muộn (₫)"
                />
              </fieldset>
            )}

            {mode === 'MONTHLY' && (
              <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                <legend className="px-1 text-xs font-medium text-muted-foreground">Cấu hình theo tháng</legend>
                <FormField
                  control={form.control}
                  name="monthly_includes_utilities"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <label className="flex items-center gap-2 text-sm">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(c) => field.onChange(c === true)}
                          />
                        </FormControl>
                        Giá đã bao gồm điện nước
                      </label>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <NumField
                  control={form.control}
                  name="monthly_electricity_per_kwh_vnd"
                  label="Đơn giá điện (₫/kWh)"
                />
                <NumField
                  control={form.control}
                  name="monthly_water_per_m3_vnd"
                  label="Đơn giá nước (₫/m³)"
                />
              </fieldset>
            )}

            <FormField
              control={form.control}
              name="is_default"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-2 text-sm">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    </FormControl>
                    Đặt làm gói mặc định cho phương thức này
                  </label>
                  <FormDescription>
                    Mỗi cơ sở chỉ có một gói mặc định cho mỗi phương thức thuê. Bật ở đây sẽ gỡ mặc định
                    khỏi gói đang giữ.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Đang lưu…' : isEdit ? 'Lưu thay đổi' : 'Tạo gói giá'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Field helper (giảm lặp cho nhóm field theo mode) ─────────────────────────

type Ctrl = ReturnType<typeof useForm<FormValues>>['control'];
type NumName = Extract<
  keyof FormValues,
  | 'hourly_base_hours'
  | 'hourly_extra_block_minutes'
  | 'hourly_extra_block_price_vnd'
  | 'hourly_overnight_surcharge_vnd'
  | 'daily_early_checkin_fee_vnd'
  | 'daily_late_checkout_fee_vnd'
  | 'monthly_electricity_per_kwh_vnd'
  | 'monthly_water_per_m3_vnd'
>;
type TimeName = Extract<
  keyof FormValues,
  'hourly_overnight_start' | 'hourly_overnight_end' | 'daily_checkin_time' | 'daily_checkout_time'
>;

function NumField({ control, name, label }: { control: Ctrl; name: NumName; label: string }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type="number" min={0} inputMode="numeric" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function TimeField({ control, name, label }: { control: Ctrl; name: TimeName; label: string }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type="time" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
