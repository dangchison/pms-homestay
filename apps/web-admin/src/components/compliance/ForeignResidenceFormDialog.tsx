'use client';

import {
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
import type { ForeignResidenceResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useBookingsList } from '@/lib/hooks/use-bookings';
import {
  useCreateForeignResidence,
  useUpdateForeignResidence,
} from '@/lib/hooks/use-foreign-residence';

/** Loại thị thực NA17 phổ biến + 'EXEMPT' (miễn thị thực). */
const VISA_TYPES: { value: string; label: string }[] = [
  { value: 'EXEMPT', label: 'Miễn thị thực' },
  { value: 'DL', label: 'DL — Du lịch' },
  { value: 'DN', label: 'DN — Doanh nghiệp' },
  { value: 'LĐ', label: 'LĐ — Lao động' },
  { value: 'ĐT', label: 'ĐT — Đầu tư' },
  { value: 'TT', label: 'TT — Thăm thân' },
];

// Form nhập chuỗi (date qua <input type="date"> = 'YYYY-MM-DD'); rỗng → bỏ khi submit.
const FormSchema = z.object({
  booking_id: z.string(),
  visa_number: z.string(),
  visa_type: z.string(),
  visa_expiry: z.string(),
  date_of_entry: z.string(),
  port_of_entry: z.string(),
  intended_departure: z.string(),
});
type FormValues = z.infer<typeof FormSchema>;

/** '' → undefined (BE bỏ trường trống); giữ giá trị đã trim. */
function orUndef(s: string): string | undefined {
  const t = s.trim();
  return t.length ? t : undefined;
}

interface Props {
  propertyId: string;
  /** Có = chế độ SỬA (khoá booking, không hiện bộ chọn). Không có = TẠO. */
  declaration?: ForeignResidenceResponse | null;
  onClose: () => void;
}

/**
 * Dialog tạo/sửa khai báo tạm trú NA17 (task 2.8). Tạo: bộ chọn booking (theo cơ sở) +
 * trường NA17. Sửa: trường NA17 (booking cố định). Chặn mở khi SUBMITTED (page không mở
 * dialog cho dòng SUBMITTED); nếu BE vẫn trả 422 FOREIGN_RESIDENCE_SUBMITTED → toast lỗi.
 */
export function ForeignResidenceFormDialog({ propertyId, declaration, onClose }: Props) {
  const isEdit = !!declaration;
  const create = useCreateForeignResidence();
  const update = useUpdateForeignResidence();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      booking_id: declaration?.booking_id ?? '',
      visa_number: '',
      visa_type: declaration?.visa_type ?? '',
      visa_expiry: declaration?.visa_expiry?.slice(0, 10) ?? '',
      date_of_entry: declaration?.date_of_entry?.slice(0, 10) ?? '',
      port_of_entry: declaration?.port_of_entry ?? '',
      intended_departure: declaration?.intended_departure?.slice(0, 10) ?? '',
    },
  });

  const onSubmit = async (values: FormValues) => {
    const fields = {
      visa_number: orUndef(values.visa_number),
      visa_type: orUndef(values.visa_type),
      visa_expiry: orUndef(values.visa_expiry),
      date_of_entry: orUndef(values.date_of_entry),
      port_of_entry: orUndef(values.port_of_entry),
      intended_departure: orUndef(values.intended_departure),
    };
    try {
      if (isEdit) {
        if (Object.values(fields).every((v) => v === undefined)) {
          toast.error('Cần ít nhất một trường để cập nhật');
          return;
        }
        await update.mutateAsync({ id: declaration!.id, body: fields });
        toast.success('Đã cập nhật khai báo tạm trú');
      } else {
        if (!values.booking_id) {
          form.setError('booking_id', { message: 'Chọn đặt phòng của khách nước ngoài' });
          return;
        }
        await create.mutateAsync({ booking_id: values.booking_id, ...fields });
        toast.success('Đã tạo khai báo tạm trú');
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.body?.code === 'FOREIGN_RESIDENCE_EXISTS') {
        form.setError('booking_id', { message: 'Đặt phòng này đã có khai báo tạm trú' });
        return;
      }
      if (err instanceof ApiClientError && err.body?.code === 'FOREIGN_RESIDENCE_SUBMITTED') {
        toast.error('Khai báo đã gửi — không thể sửa');
        return;
      }
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : isEdit
            ? 'Cập nhật khai báo thất bại'
            : 'Tạo khai báo thất bại',
      );
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa khai báo tạm trú' : 'Thêm khai báo tạm trú'}</DialogTitle>
          <DialogDescription>
            Khai báo tạm trú khách nước ngoài (mẫu NA17) gửi Cục Quản lý xuất nhập cảnh.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            {!isEdit && <BookingPicker propertyId={propertyId} form={form} />}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="visa_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Loại thị thực</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn / miễn" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {VISA_TYPES.map((t) => (
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
              <FormField
                control={form.control}
                name="visa_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Số thị thực</FormLabel>
                    <FormControl>
                      <Input placeholder="Bỏ trống nếu miễn thị thực" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="date_of_entry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ngày nhập cảnh</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="visa_expiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Thị thực hết hạn</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="port_of_entry"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cửa khẩu nhập cảnh</FormLabel>
                  <FormControl>
                    <Input placeholder="VD Sân bay quốc tế Đà Nẵng" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="intended_departure"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ngày dự kiến rời đi</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Bộ chọn booking theo cơ sở đang chọn (useBookingsList) — chỉ ở chế độ TẠO. */
function BookingPicker({
  propertyId,
  form,
}: {
  propertyId: string;
  form: ReturnType<typeof useForm<FormValues>>;
}) {
  const { data } = useBookingsList(propertyId, {});
  const bookings = data?.data ?? [];
  return (
    <FormField
      control={form.control}
      name="booking_id"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Đặt phòng</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger id="booking_id">
                <SelectValue placeholder="Chọn đặt phòng của khách nước ngoài" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {bookings.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.booking_code} — {b.guest_name ?? 'Khách lẻ'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
