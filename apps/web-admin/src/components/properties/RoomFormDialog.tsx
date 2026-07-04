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
  toast,
} from '@pms/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiClientError } from '@/lib/api-client';
import { useCreateRoom } from '@/lib/hooks/use-rooms';

// Schema cục bộ (input == output, không .default()) — property_id gắn lúc submit từ prop.
const FormSchema = z.object({
  room_number: z.string().min(1, 'Bắt buộc').max(50),
  display_name: z.string().max(255).optional(),
  capacity_adults: z.number().int().min(1).optional(),
});
type FormValues = z.infer<typeof FormSchema>;

/** Dialog "Thêm phòng" (task 1.3, /properties tab Phòng). Mount khi mở → state mới mỗi lần. */
export function RoomFormDialog({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const create = useCreateRoom();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { room_number: '', display_name: '', capacity_adults: undefined },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await create.mutateAsync({
        property_id: propertyId,
        room_number: values.room_number,
        display_name: values.display_name || undefined,
        capacity_adults: values.capacity_adults,
      });
      toast.success('Đã thêm phòng');
      form.reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Thêm phòng thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thêm phòng</DialogTitle>
          <DialogDescription>Khai báo phòng vật lý mới cho cơ sở này.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <FormField
              control={form.control}
              name="room_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Số phòng</FormLabel>
                  <FormControl>
                    <Input placeholder="VD 101" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tên hiển thị (tuỳ chọn)</FormLabel>
                  <FormControl>
                    <Input placeholder="VD Phòng 101 — Hướng biển" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capacity_adults"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sức chứa (người lớn, tuỳ chọn)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Đang thêm…' : 'Thêm phòng'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
