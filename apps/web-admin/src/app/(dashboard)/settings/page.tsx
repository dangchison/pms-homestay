'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, Input, Label, Skeleton, toast } from '@pms/ui';
import { Loader2 } from 'lucide-react';
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

/** S1 /settings — hồ sơ tenant (task 6.7). Sửa: OWNER (tenant.update). */
export default function TenantProfilePage() {
  const { data: tenant, isLoading } = useTenant();
  const update = useUpdateTenant();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'OWNER';

  const [displayName, setDisplayName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [timezone, setTimezone] = useState('Asia/Ho_Chi_Minh');
  const [currency, setCurrency] = useState('VND');

  useEffect(() => {
    if (tenant) {
      setDisplayName(tenant.display_name);
      setBusinessType(tenant.business_type ?? '');
      setTimezone(tenant.timezone);
      setCurrency(tenant.currency);
    }
  }, [tenant]);

  const save = async () => {
    try {
      await update.mutateAsync({
        display_name: displayName,
        business_type: businessType || null,
        timezone,
        currency,
      });
      toast.success('Đã lưu hồ sơ cơ sở');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Lưu thất bại');
    }
  };

  if (isLoading || !tenant) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <Card>
      <CardContent className="grid gap-5 py-6">
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

        <div className="grid gap-1.5">
          <Label htmlFor="name">Tên hiển thị</Label>
          <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={!canEdit} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="biz">Loại hình</Label>
            <Input id="biz" placeholder="vd: Homestay, Khách sạn mini" value={businessType} onChange={(e) => setBusinessType(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tz">Múi giờ</Label>
            <select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canEdit} className="h-9 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-1.5 sm:max-w-[12rem]">
          <Label htmlFor="cur">Tiền tệ</Label>
          <Input id="cur" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} disabled={!canEdit} />
        </div>

        {canEdit ? (
          <div>
            <Button onClick={save} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Lưu thay đổi
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chỉ chủ nhà (OWNER) được chỉnh sửa hồ sơ cơ sở.</p>
        )}
      </CardContent>
    </Card>
  );
}
