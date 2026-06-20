'use client';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
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
  Separator,
  toast,
} from '@pms/ui';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { UserRoleSchema, type UserResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useProperties } from '@/lib/hooks/use-properties';
import { useAssignRole, useDeleteRole, useUserPropertyRoles } from '@/lib/hooks/use-users';
import { ROLE_LABEL, ROLE_OPTIONS } from './roles';

const splitKeys = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean);

const AddSchema = z.object({
  property_id: z.string().uuid('Chọn cơ sở'),
  role: UserRoleSchema,
  grant: z.string().optional(),
  deny: z.string().optional(),
});
type AddValues = z.infer<typeof AddSchema>;

/** Gán role theo cơ sở + override grant/deny cho 1 user (S2). */
export function UserRolesDialog({ user, open, onOpenChange }: { user: UserResponse; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: properties } = useProperties();
  const { data: roles, isLoading } = useUserPropertyRoles(open ? user.id : null);
  const assign = useAssignRole();
  const del = useDeleteRole();
  const form = useForm<AddValues>({
    resolver: zodResolver(AddSchema),
    defaultValues: { property_id: '', role: 'STAFF', grant: '', deny: '' },
  });

  const propName = (id: string) => properties?.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  const onAdd = async (values: AddValues) => {
    try {
      await assign.mutateAsync({
        user_id: user.id,
        property_id: values.property_id,
        role: values.role,
        permissions: { grant: splitKeys(values.grant ?? ''), deny: splitKeys(values.deny ?? '') },
      });
      toast.success('Đã gán quyền theo cơ sở');
      form.reset({ property_id: '', role: values.role, grant: '', deny: '' });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Gán quyền thất bại');
    }
  };

  const remove = async (id: string) => {
    try {
      await del.mutateAsync(id);
      toast.success('Đã gỡ quyền');
    } catch {
      toast.error('Gỡ quyền thất bại');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Phân quyền theo cơ sở · {user.full_name}</DialogTitle>
          <DialogDescription>Gán vai trò theo từng cơ sở và tinh chỉnh quyền (grant/deny).</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : (roles?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa gán cơ sở nào (dùng vai trò mặc định).</p>
          ) : (
            <div className="grid gap-2">
              {roles!.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border border-border p-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{propName(r.property_id)}</span>
                      <Badge variant="secondary" className="text-[10px]">{ROLE_LABEL[r.role]}</Badge>
                    </div>
                    {(r.permissions.grant.length > 0 || r.permissions.deny.length > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                        {r.permissions.grant.map((g) => (
                          <span key={g} className="rounded bg-success/10 px-1.5 py-0.5 text-success">+{g}</span>
                        ))}
                        {r.permissions.deny.map((d) => (
                          <span key={d} className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">−{d}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => remove(r.id)} disabled={del.isPending}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Separator />
          <p className="text-sm font-medium">Thêm phân quyền</p>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onAdd)} className="grid gap-3" noValidate>
              <div className="grid grid-cols-2 gap-2">
                <FormField
                  control={form.control}
                  name="property_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Cơ sở</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="— chọn —" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(properties ?? []).map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
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
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Vai trò</FormLabel>
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
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FormField
                  control={form.control}
                  name="grant"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Cấp thêm quyền (grant, cách nhau dấu phẩy)</FormLabel>
                      <FormControl>
                        <Input placeholder="report.financial" className="text-sm" {...field} value={field.value ?? ''} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="deny"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Thu hồi quyền (deny)</FormLabel>
                      <FormControl>
                        <Input placeholder="booking.cancel" className="text-sm" {...field} value={field.value ?? ''} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <Button type="submit" disabled={assign.isPending} className="justify-self-start">
                {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Thêm
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
