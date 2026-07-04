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
import { CreateRoomBlockRequestSchema, type CreateRoomBlockRequest } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { isoToLocalInput, localInputToIso } from '@/lib/datetime';
import { useCreateRoomBlock } from '@/lib/hooks/use-room-blocks';

/**
 * Dialog "Thêm block" (task 1.3, /properties tab Block bảo trì). Form state giữ start_at/end_at
 * dạng ISO (CreateRoomBlockRequestSchema dùng z.iso.datetime() + refine end>start); input
 * datetime-local hiển thị/nhập giờ trình duyệt qua cầu iso↔local (datetime.ts).
 */
export function RoomBlockFormDialog({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const create = useCreateRoomBlock();
  const form = useForm<CreateRoomBlockRequest>({
    resolver: zodResolver(CreateRoomBlockRequestSchema),
    defaultValues: { room_id: roomId, start_at: '', end_at: '', reason: '' },
  });

  const onSubmit = async (values: CreateRoomBlockRequest) => {
    try {
      await create.mutateAsync(values);
      toast.success('Đã thêm block bảo trì');
      form.reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Thêm block thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thêm block bảo trì</DialogTitle>
          <DialogDescription>Chặn phòng trong khoảng thời gian (bảo trì / owner dùng).</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <FormField
              control={form.control}
              name="start_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Từ</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      value={field.value ? isoToLocalInput(field.value) : ''}
                      onChange={(e) => field.onChange(localInputToIso(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="end_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Đến</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      value={field.value ? isoToLocalInput(field.value) : ''}
                      onChange={(e) => field.onChange(localInputToIso(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lý do</FormLabel>
                  <FormControl>
                    <Input placeholder="VD Bảo trì điều hoà" {...field} />
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
                {create.isPending ? 'Đang thêm…' : 'Thêm block'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
