'use client';

import { useState } from 'react';
import Link from 'next/link';
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
  CreatePropertyRequest,
  PropertyResponse,
  PropertyType,
  UpdatePropertyRequest,
} from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useCreateProperty, useUpdateProperty } from '@/lib/hooks/use-properties';
import { bpToPercent, percentToBp } from '@/lib/rate-plan-format';

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: 'HOMESTAY', label: 'Homestay' },
  { value: 'RENT_TO_RENT', label: 'Thuê lại cho thuê' },
  { value: 'APARTMENT', label: 'Căn hộ dịch vụ' },
  { value: 'HOTEL', label: 'Khách sạn' },
];

/** Múi giờ hay dùng ở Việt Nam; cơ sở ở nước ngoài thì gõ tay mã IANA. */
const TIMEZONES = ['Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'UTC'];

const numOpt = z
  .string()
  .refine((s) => s.trim() === '' || (Number.isFinite(Number(s)) && Number(s) >= 0), 'Số không hợp lệ');

const FormSchema = z
  .object({
    name: z.string().min(1, 'Bắt buộc').max(255),
    property_type: z.enum(['HOMESTAY', 'RENT_TO_RENT', 'APARTMENT', 'HOTEL']),
    address_line: z.string().min(1, 'Bắt buộc').max(500),
    ward: z.string().max(100),
    district: z.string().max(100),
    province: z.string().min(1, 'Bắt buộc — cần cho báo cáo lưu trú công an').max(100),
    timezone: z.string().min(1).max(64),
    police_business_code: z.string().max(50),
    is_rent_to_rent: z.boolean(),
    landlord_name: z.string().max(255),
    landlord_phone: z.string().max(20),
    rent_to_rent_contract_start: z.string(),
    rent_to_rent_contract_end: z.string(),
    /** Hai mô hình trả chủ nhà loại trừ nhau — property.ts §27-29. */
    landlord_model: z.enum(['FIXED_RENT', 'REVENUE_SHARE']),
    monthly_landlord_rent_vnd: numOpt,
    /** Người dùng nhập %, lưu xuống DB là basis point. */
    landlord_revenue_share_percent: numOpt,
  })
  .refine(
    (d) =>
      !d.rent_to_rent_contract_end ||
      !d.rent_to_rent_contract_start ||
      d.rent_to_rent_contract_end > d.rent_to_rent_contract_start,
    { message: 'Ngày kết thúc phải sau ngày bắt đầu', path: ['rent_to_rent_contract_end'] },
  )
  .refine((d) => Number(d.landlord_revenue_share_percent || 0) <= 100, {
    message: 'Tỉ lệ tối đa 100%',
    path: ['landlord_revenue_share_percent'],
  });

type FormValues = z.infer<typeof FormSchema>;

const show = (n: number | null | undefined): string => (n == null ? '' : String(n));

function toDefaults(property: PropertyResponse | null): FormValues {
  if (!property) {
    return {
      name: '',
      property_type: 'HOMESTAY',
      address_line: '',
      ward: '',
      district: '',
      province: '',
      timezone: 'Asia/Ho_Chi_Minh',
      police_business_code: '',
      is_rent_to_rent: false,
      landlord_name: '',
      landlord_phone: '',
      rent_to_rent_contract_start: '',
      rent_to_rent_contract_end: '',
      landlord_model: 'FIXED_RENT',
      monthly_landlord_rent_vnd: '',
      landlord_revenue_share_percent: '',
    };
  }
  return {
    name: property.name,
    property_type: property.property_type,
    address_line: property.address_line,
    ward: property.ward ?? '',
    district: property.district ?? '',
    province: property.province,
    timezone: property.timezone,
    police_business_code: property.police_business_code ?? '',
    is_rent_to_rent: property.is_rent_to_rent,
    landlord_name: property.landlord_name ?? '',
    landlord_phone: property.landlord_phone ?? '',
    rent_to_rent_contract_start: property.rent_to_rent_contract_start?.slice(0, 10) ?? '',
    rent_to_rent_contract_end: property.rent_to_rent_contract_end?.slice(0, 10) ?? '',
    landlord_model: property.landlord_revenue_share_bp != null ? 'REVENUE_SHARE' : 'FIXED_RENT',
    monthly_landlord_rent_vnd: show(property.monthly_landlord_rent_vnd),
    landlord_revenue_share_percent:
      property.landlord_revenue_share_bp == null
        ? ''
        : String(bpToPercent(property.landlord_revenue_share_bp)),
  };
}

const str = (s: string): string | undefined => (s.trim() === '' ? undefined : s);

function toPayload(v: FormValues): CreatePropertyRequest {
  const base: CreatePropertyRequest = {
    name: v.name,
    property_type: v.property_type,
    address_line: v.address_line,
    province: v.province,
    timezone: v.timezone,
    is_rent_to_rent: v.is_rent_to_rent,
    ...(str(v.ward) ? { ward: v.ward } : {}),
    ...(str(v.district) ? { district: v.district } : {}),
    ...(str(v.police_business_code) ? { police_business_code: v.police_business_code } : {}),
  };
  if (!v.is_rent_to_rent) return base;

  return {
    ...base,
    ...(str(v.landlord_name) ? { landlord_name: v.landlord_name } : {}),
    ...(str(v.landlord_phone) ? { landlord_phone: v.landlord_phone } : {}),
    ...(str(v.rent_to_rent_contract_start)
      ? { rent_to_rent_contract_start: v.rent_to_rent_contract_start }
      : {}),
    ...(str(v.rent_to_rent_contract_end)
      ? { rent_to_rent_contract_end: v.rent_to_rent_contract_end }
      : {}),
    // Chỉ gửi ĐÚNG MỘT trong hai mô hình — đặt cả hai thì BE ưu tiên chia doanh thu,
    // dễ thành cấu hình ngầm mà chủ cơ sở không nhận ra.
    ...(v.landlord_model === 'REVENUE_SHARE'
      ? str(v.landlord_revenue_share_percent)
        ? { landlord_revenue_share_bp: percentToBp(Number(v.landlord_revenue_share_percent)) }
        : {}
      : str(v.monthly_landlord_rent_vnd)
        ? { monthly_landlord_rent_vnd: Number(v.monthly_landlord_rent_vnd) }
        : {}),
  };
}

/** Dialog tạo/sửa cơ sở lưu trú. */
export function PropertyFormDialog({
  property,
  onClose,
}: {
  property: PropertyResponse | null;
  onClose: () => void;
}) {
  const create = useCreateProperty();
  const update = useUpdateProperty();
  const isEdit = property != null;
  const pending = create.isPending || update.isPending;
  const [planLimit, setPlanLimit] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(property),
  });
  const isR2R = form.watch('is_rent_to_rent');
  const landlordModel = form.watch('landlord_model');

  const onSubmit = async (v: FormValues) => {
    try {
      if (isEdit) {
        const body: UpdatePropertyRequest = toPayload(v);
        await update.mutateAsync({ id: property.id, ...body });
        toast.success('Đã cập nhật cơ sở');
      } else {
        await create.mutateAsync(toPayload(v));
        toast.success('Đã tạo cơ sở');
      }
      onClose();
    } catch (err) {
      // KHÔNG hiện nguyên văn `detail` của BE: chuỗi đó viết cho lập trình viên
      // ("tối đa 5 property... POST /billing/charge"). Trang gói dịch vụ đã hiện
      // hạn mức thật, ở đây chỉ cần nói rõ chuyện gì xảy ra và làm gì tiếp.
      if (err instanceof ApiClientError && err.body?.code === 'PLAN_LIMIT_REACHED') {
        setPlanLimit(true);
        return;
      }
      toast.error(err instanceof ApiClientError ? err.message : 'Lưu cơ sở thất bại');
    }
  };

  if (planLimit) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gói hiện tại đã hết chỗ</DialogTitle>
            <DialogDescription>
              Bạn đã dùng hết số cơ sở mà gói dịch vụ hiện tại cho phép. Nâng gói để thêm cơ sở
              mới — dữ liệu đang có giữ nguyên.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPlanLimit(false)}>
              Quay lại
            </Button>
            <Button asChild>
              <Link href="/settings/billing">Xem gói dịch vụ</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa cơ sở' : 'Thêm cơ sở'}</DialogTitle>
          <DialogDescription>
            Tỉnh/thành và mã kinh doanh dùng cho báo cáo lưu trú gửi công an. Múi giờ quyết định
            mốc chốt sổ đêm của cơ sở.
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
                    <FormLabel>Tên cơ sở</FormLabel>
                    <FormControl>
                      <Input placeholder="VD Homestay Mỹ Khê" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="property_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Loại hình</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label="Loại hình">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROPERTY_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address_line"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Địa chỉ</FormLabel>
                  <FormControl>
                    <Input placeholder="Số nhà, đường" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="ward"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phường/xã</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="district"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quận/huyện</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="province"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tỉnh/thành</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Múi giờ</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label="Múi giờ">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz}
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
                name="police_business_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mã kinh doanh lưu trú</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>Do công an cấp; dùng khi khai báo lưu trú.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="is_rent_to_rent"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-2 text-sm">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    </FormControl>
                    Cơ sở này đi thuê lại rồi cho thuê
                  </label>
                  <FormDescription>
                    Bật để nhập thông tin chủ nhà gốc — cần cho bảng kê chia tiền theo kỳ.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isR2R && (
              <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                <legend className="px-1 text-xs font-medium text-muted-foreground">
                  Chủ nhà gốc
                </legend>
                <FormField
                  control={form.control}
                  name="landlord_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tên chủ nhà</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="landlord_phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Điện thoại</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="rent_to_rent_contract_start"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hợp đồng từ</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="rent_to_rent_contract_end"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Đến</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="landlord_model"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Cách trả chủ nhà</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger aria-label="Cách trả chủ nhà">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="FIXED_RENT">Tiền thuê cố định hằng tháng</SelectItem>
                          <SelectItem value="REVENUE_SHARE">Chia phần trăm doanh thu</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Chọn một trong hai — hệ thống chỉ lưu mô hình được chọn.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {landlordModel === 'FIXED_RENT' ? (
                  <FormField
                    control={form.control}
                    name="monthly_landlord_rent_vnd"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Tiền thuê hằng tháng (₫)</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} inputMode="numeric" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name="landlord_revenue_share_percent"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Chủ nhà hưởng (% doanh thu)</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} max={100} inputMode="numeric" {...field} />
                        </FormControl>
                        <FormDescription>Nhập theo phần trăm, ví dụ 40.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </fieldset>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Đang lưu…' : isEdit ? 'Lưu thay đổi' : 'Tạo cơ sở'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
