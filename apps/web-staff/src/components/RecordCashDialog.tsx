'use client';

import {
  Button,
  Dialog,
  DialogContent,
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
import { Loader2 } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PaymentMethodSchema, type InvoiceResponse, type PaymentMethod } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useRecordPayment } from '@/lib/hooks/use-invoices';
import { vnd } from '@/lib/format';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Tiền mặt' },
  { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
  { value: 'CARD', label: 'Thẻ' },
];

const FormSchema = z.object({
  amount_vnd: z.number().int().positive('Số tiền không hợp lệ'),
  method: PaymentMethodSchema,
});
type FormValues = z.infer<typeof FormSchema>;

/** Ghi nhận thanh toán thủ công cho 1 hoá đơn (mặc định = số còn lại, tiền mặt). */
export function RecordCashDialog({
  invoice,
  open,
  onOpenChange,
  disabled,
}: {
  invoice: InvoiceResponse;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  disabled?: boolean;
}) {
  const record = useRecordPayment();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { amount_vnd: invoice.balance_vnd, method: 'CASH' },
  });
  const amount = form.watch('amount_vnd');

  const onSubmit = async (values: FormValues) => {
    if (values.amount_vnd > invoice.balance_vnd) {
      toast.error('Số tiền không hợp lệ');
      return;
    }
    try {
      await record.mutateAsync({
        body: { invoice_id: invoice.id, amount_vnd: values.amount_vnd, method: values.method },
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success('Đã ghi nhận thanh toán');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Ghi nhận thất bại');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ghi nhận thanh toán</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="amount_vnd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Số tiền (còn lại {vnd(invoice.balance_vnd)})</FormLabel>
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
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phương thức</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="h-12 text-base">
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
            <DialogFooter>
              <Button type="submit" className="h-12 w-full text-base" disabled={disabled || record.isPending}>
                {record.isPending ? <Loader2 className="size-5 animate-spin" /> : `Ghi nhận ${vnd(amount || 0)}`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
