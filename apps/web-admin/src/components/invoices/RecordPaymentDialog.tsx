'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
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
import { PaymentMethodSchema, type InvoiceResponse, type PaymentMethod } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { vnd } from '@/lib/format';
import { useRecordPayment } from '@/lib/hooks/use-invoices';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Tiền mặt' },
  { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
  { value: 'VIETQR', label: 'VietQR' },
  { value: 'MOMO', label: 'MoMo' },
  { value: 'CARD', label: 'Thẻ' },
  { value: 'OTHER', label: 'Khác' },
];

// Schema cục bộ (không `.default()` để input==output — RHF resolver gọn). invoice_id
// lấy từ prop, gắn lúc submit.
const FormSchema = z.object({
  amount_vnd: z.number().int().positive('Số tiền phải lớn hơn 0'),
  method: PaymentMethodSchema,
  reference_code: z.string().max(255).optional(),
});
type FormValues = z.infer<typeof FormSchema>;

/** Dialog ghi nhận thanh toán (task 6.4, F2). Mount khi mở → state khởi tạo mới mỗi lần. */
export function RecordPaymentDialog({ invoice, onClose }: { invoice: InvoiceResponse; onClose: () => void }) {
  const record = useRecordPayment();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { amount_vnd: invoice.balance_vnd, method: 'CASH', reference_code: '' },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await record.mutateAsync({
        body: {
          invoice_id: invoice.id,
          amount_vnd: values.amount_vnd,
          method: values.method,
          reference_code: values.reference_code || undefined,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success('Đã ghi nhận thanh toán');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Ghi nhận thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ghi nhận thanh toán</DialogTitle>
          <DialogDescription>Ghi nhận khoản khách đã trả cho hoá đơn này.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phương thức</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {METHODS.map((m) => (
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
              name="amount_vnd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Số tiền (mặc định = còn lại {vnd(invoice.balance_vnd)})</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
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
              name="reference_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mã tham chiếu (tuỳ chọn)</FormLabel>
                  <FormControl>
                    <Input placeholder="Mã CK / biên lai" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={record.isPending}>
                {record.isPending ? 'Đang ghi…' : 'Ghi nhận'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
