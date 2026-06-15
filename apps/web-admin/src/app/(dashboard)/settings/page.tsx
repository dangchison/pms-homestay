'use client';

import { useEffect } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@pms/ui';
import { Loader2 } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiClientError } from '@/lib/api-client';
import { useTenant, useUpdateTenant } from '@/lib/hooks/use-tenant';
import { useAuthStore } from '@/stores/auth.store';

const TIMEZONES = ['Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'UTC'];
const STATUS_LABEL: Record<string, string> = {
  TRIAL: 'Dùng thử',
  ACTIVE: 'Đang hoạt động',
  SUSPENDED: 'Tạm ngưng',
  CHURNED: 'Đã ngừng',
};

const FormSchema = z.object({
  display_name: z.string().min(1, 'Cần tên hiển thị'),
  business_type: z.string(),
  timezone: z.string(),
  currency: z.string().min(1, 'Cần tiền tệ').max(3),
});
type FormValues = z.infer<typeof FormSchema>;

/** S1 /settings — hồ sơ tenant (task 6.7). Sửa: OWNER (tenant.update). */
export default function TenantProfilePage() {
  const { data: tenant, isLoading } = useTenant();
  const update = useUpdateTenant();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'OWNER';

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { display_name: '', business_type: '', timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
  });

  useEffect(() => {
    if (tenant) {
      form.reset({
        display_name: tenant.display_name,
        business_type: tenant.business_type ?? '',
        timezone: tenant.timezone,
        currency: tenant.currency,
      });
    }
  }, [tenant, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      await update.mutateAsync({
        display_name: values.display_name,
        business_type: values.business_type || null,
        timezone: values.timezone,
        currency: values.currency,
      });
      toast.success('Đã lưu hồ sơ cơ sở');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Lưu thất bại');
    }
  };

  if (isLoading || !tenant) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <Card>
      <CardContent className="py-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5" noValidate>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Mã homestay (slug)</Label>
                <Input value={tenant.slug} disabled className="bg-muted" />
              </div>
              <div className="grid gap-1.5">
                <Label>Trạng thái</Label>
                <div className="flex h-9 items-center">
                  <Badge variant="secondary">{STATUS_LABEL[tenant.status] ?? tenant.status}</Badge>
                </div>
              </div>
            </div>

            <FormField
              control={form.control}
              name="display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tên hiển thị</FormLabel>
                  <FormControl>
                    <Input disabled={!canEdit} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-2 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="business_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Loại hình</FormLabel>
                    <FormControl>
                      <Input placeholder="vd: Homestay, Khách sạn mini" disabled={!canEdit} {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Múi giờ</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
                      <FormControl>
                        <SelectTrigger>
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
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem className="sm:max-w-[12rem]">
                  <FormLabel>Tiền tệ</FormLabel>
                  <FormControl>
                    <Input
                      disabled={!canEdit}
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase().slice(0, 3))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {canEdit ? (
              <div>
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Lưu thay đổi
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Chỉ chủ nhà (OWNER) được chỉnh sửa hồ sơ cơ sở.</p>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
