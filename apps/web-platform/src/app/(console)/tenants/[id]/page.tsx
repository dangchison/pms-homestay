'use client';

import { use } from 'react';
import Link from 'next/link';
import { type SubscriptionPlanCode } from '@pms/shared-types';
import { Badge, Button, Card, CardContent, Skeleton, toast } from '@pms/ui';
import { PageContainer, PageHeader } from '@/components/layout';
import { ApiClientError } from '@/lib/api-client';
import { dateTime } from '@/lib/format';
import { usePlans, useTenant, useUpdateTenant } from '@/lib/hooks/use-platform';

/** Chi tiết tenant: gói, trạng thái, usage thật (kể cả trần theo từng cơ sở). */
export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: tenant, isLoading } = useTenant(id);
  const { data: plans } = usePlans();
  const update = useUpdateTenant();

  const apply = async (patch: { plan_code?: SubscriptionPlanCode; status?: 'ACTIVE' | 'SUSPENDED' }) => {
    try {
      await update.mutateAsync({ id, patch });
      toast.success('Đã cập nhật tenant');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Không cập nhật được');
    }
  };

  if (isLoading || !tenant) return <Skeleton className="h-72 w-full rounded-xl" />;

  const overTotal = tenant.plan ? tenant.usage.rooms > tenant.plan.max_rooms : false;

  return (
    <PageContainer>
      <PageHeader
        title={tenant.display_name}
        description={tenant.slug}
        action={
          <Link href="/tenants" className="text-sm text-muted-foreground hover:text-foreground">
            ← Danh sách
          </Link>
        }
      />

      <Card>
        <CardContent className="grid gap-4 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">{tenant.status}</Badge>
            <Badge variant="outline">{tenant.plan?.code ?? 'chưa có gói'}</Badge>
            <span className="text-sm text-muted-foreground">
              Hết dùng thử: {dateTime(tenant.trial_ends_at)} · Hết kỳ:{' '}
              {dateTime(tenant.current_period_end)}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <span className="self-center text-sm font-medium">Đổi gói:</span>
            {(plans ?? []).map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={p.code === tenant.plan?.code ? 'default' : 'outline'}
                disabled={p.code === tenant.plan?.code || update.isPending}
                onClick={() => apply({ plan_code: p.code })}
              >
                {p.code}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="self-center text-sm font-medium">Trạng thái:</span>
            <Button
              size="sm"
              variant="outline"
              disabled={tenant.status === 'ACTIVE' || update.isPending}
              onClick={() => apply({ status: 'ACTIVE' })}
            >
              Kích hoạt
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={tenant.status === 'SUSPENDED' || update.isPending}
              onClick={() => apply({ status: 'SUSPENDED' })}
            >
              Tạm ngưng
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 py-5">
          <p className="text-sm font-medium">Đang dùng</p>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <Usage label="Cơ sở" used={tenant.usage.properties} max={tenant.plan?.max_properties} />
            <Usage label="Phòng (tổng)" used={tenant.usage.rooms} max={tenant.plan?.max_rooms} />
            <Usage label="Người dùng" used={tenant.usage.users} max={tenant.plan?.max_users} />
          </dl>

          {tenant.usage.rooms_by_property.length > 0 && (
            <div className="grid gap-2 border-t border-border pt-4">
              <p className="text-sm font-medium">Phòng theo từng cơ sở</p>
              <ul className="grid gap-1 text-sm">
                {tenant.usage.rooms_by_property.map((p) => {
                  const max = tenant.plan?.max_rooms_per_property;
                  const over = max !== undefined && p.rooms > max;
                  return (
                    <li key={p.property_id} className="flex justify-between gap-4">
                      <span className="truncate text-muted-foreground">{p.property_name}</span>
                      <span className={over ? 'font-medium text-destructive' : 'font-medium'}>
                        {p.rooms} / {max ?? '—'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {overTotal && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
              Tenant đang vượt trần của gói. Dữ liệu cũ vẫn giữ nguyên, hệ thống chỉ chặn tạo mới.
            </p>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function Usage({ label, used, max }: { label: string; used: number; max?: number }) {
  const over = max !== undefined && used > max;
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={over ? 'font-medium text-destructive' : 'font-medium'}>
        {used} / {max ?? '—'}
      </dd>
    </div>
  );
}
