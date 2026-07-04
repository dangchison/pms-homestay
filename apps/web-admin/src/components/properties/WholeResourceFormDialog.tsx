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
import type { RoomResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useCreateWholeResource } from '@/lib/hooks/use-resources';

// property_id gắn lúc submit. room_ids ≥1 (checkbox group — @pms/ui không có multi-select).
const FormSchema = z.object({
  name: z.string().min(1, 'Bắt buộc').max(255),
  room_ids: z.array(z.uuid()).min(1, 'Chọn ít nhất 1 phòng thành viên'),
});
type FormValues = z.infer<typeof FormSchema>;

/** Dialog "Thêm nguyên căn (WHOLE)" (task 1.3, /properties tab Bookable unit). */
export function WholeResourceFormDialog({
  propertyId,
  rooms,
  onClose,
}: {
  propertyId: string;
  rooms: RoomResponse[];
  onClose: () => void;
}) {
  const create = useCreateWholeResource();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', room_ids: [] },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await create.mutateAsync({
        property_id: propertyId,
        name: values.name,
        room_ids: values.room_ids,
      });
      toast.success('Đã thêm nguyên căn');
      form.reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Thêm nguyên căn thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thêm nguyên căn (WHOLE)</DialogTitle>
          <DialogDescription>
            Gộp nhiều phòng thành một đơn vị bán nguyên căn. Chọn ít nhất một phòng thành viên.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tên nguyên căn</FormLabel>
                  <FormControl>
                    <Input placeholder="VD Nguyên căn Tầng 3" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="room_ids"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phòng thành viên</FormLabel>
                  <div className="flex max-h-52 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
                    {rooms.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Chưa có phòng nào.</p>
                    ) : (
                      rooms.map((room) => {
                        const checked = field.value.includes(room.id);
                        return (
                          <label key={room.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) =>
                                field.onChange(
                                  c === true
                                    ? [...field.value, room.id]
                                    : field.value.filter((id) => id !== room.id),
                                )
                              }
                            />
                            {room.room_number}
                            {room.display_name ? ` — ${room.display_name}` : ''}
                          </label>
                        );
                      })
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Đang thêm…' : 'Thêm nguyên căn'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
