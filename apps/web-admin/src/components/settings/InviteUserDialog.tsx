'use client';

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Loader2, UserPlus } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { InviteUserRequestSchema, type InviteUserRequest } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useInviteUser } from '@/lib/hooks/use-users';
import { ROLE_LABEL, ROLE_OPTIONS } from './roles';

/** Mời user mới (email + role mặc định). Gửi email đặt mật khẩu (BE best-effort). */
export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const invite = useInviteUser();
  const form = useForm<InviteUserRequest>({
    resolver: zodResolver(InviteUserRequestSchema),
    defaultValues: { email: '', full_name: '', default_role: 'STAFF' },
  });

  const onSubmit = async (values: InviteUserRequest) => {
    try {
      await invite.mutateAsync(values);
      toast.success('Đã mời — email đặt mật khẩu đã được gửi');
      setOpen(false);
      form.reset();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Mời thất bại');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" />
          Mời người dùng
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mời người dùng</DialogTitle>
          <DialogDescription>Gửi email mời và gán vai trò cho thành viên mới.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Họ tên</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="default_role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vai trò mặc định</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Gửi lời mời
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
