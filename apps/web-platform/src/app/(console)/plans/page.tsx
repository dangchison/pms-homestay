'use client';

import { useState } from 'react';
import { PLAN_FEATURES, PLAN_FEATURE_LABEL, type PlatformPlan } from '@pms/shared-types';
import { Badge, Button, Card, CardContent, Checkbox, Input, Label, Skeleton, toast } from '@pms/ui';
import { PageContainer, PageHeader } from '@/components/layout';
import { ApiClientError } from '@/lib/api-client';
import { planPrice } from '@/lib/format';
import { usePlans, useUpdatePlan } from '@/lib/hooks/use-platform';

type LimitField = 'max_properties' | 'max_rooms_per_property' | 'max_rooms' | 'max_users' | 'monthly_price_vnd';

const LIMIT_FIELDS: { key: LimitField; label: string; hint?: string }[] = [
  { key: 'max_properties', label: 'Số cơ sở' },
  { key: 'max_rooms_per_property', label: 'Phòng mỗi cơ sở', hint: 'Không được lớn hơn trần tổng' },
  { key: 'max_rooms', label: 'Phòng tổng' },
  { key: 'max_users', label: 'Người dùng' },
  { key: 'monthly_price_vnd', label: 'Giá / tháng (₫)', hint: '0 = liên hệ báo giá' },
];

/** Cấu hình gói — sửa hạn mức và cờ tính năng, có hiệu lực ngay với tenant đang chạy. */
export default function PlansPage() {
  const { data: plans, isLoading } = usePlans();

  return (
    <PageContainer>
      <PageHeader
        title="Gói thuê bao"
        description="Đổi hạn mức hoặc tính năng ở đây là tenant thấy ngay, không cần khởi động lại API."
      />
      {isLoading && <Skeleton className="h-64 w-full rounded-xl" />}
      <div className="grid gap-4">
        {(plans ?? []).map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>
    </PageContainer>
  );
}

function PlanCard({ plan }: { plan: PlatformPlan }) {
  const update = useUpdatePlan();
  const [editing, setEditing] = useState(false);
  const [limits, setLimits] = useState<Record<LimitField, string>>(() => toLimitForm(plan));
  const [features, setFeatures] = useState<Record<string, boolean>>(() => toFeatureForm(plan));

  const cancel = () => {
    setLimits(toLimitForm(plan));
    setFeatures(toFeatureForm(plan));
    setEditing(false);
  };

  const save = async () => {
    try {
      await update.mutateAsync({
        id: plan.id,
        patch: {
          max_properties: Number(limits.max_properties),
          max_rooms: Number(limits.max_rooms),
          max_rooms_per_property: Number(limits.max_rooms_per_property),
          max_users: Number(limits.max_users),
          monthly_price_vnd: Number(limits.monthly_price_vnd),
          features,
        },
      });
      toast.success(`Đã cập nhật gói ${plan.code}`);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Không lưu được gói');
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">{plan.code}</span>
              <Badge variant="secondary">{plan.name}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {planPrice(plan.code, plan.monthly_price_vnd)} · {plan.tenant_count} tenant đang dùng
            </p>
          </div>
          {editing ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={cancel} disabled={update.isPending}>
                Huỷ
              </Button>
              <Button size="sm" onClick={save} disabled={update.isPending}>
                {update.isPending ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Sửa
            </Button>
          )}
        </div>

        {editing ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {LIMIT_FIELDS.map((f) => (
                <div key={f.key} className="grid gap-1.5">
                  <Label htmlFor={`${plan.id}-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`${plan.id}-${f.key}`}
                    type="number"
                    min={0}
                    value={limits[f.key]}
                    onChange={(e) => setLimits((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                  {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                </div>
              ))}
            </div>
            <div className="grid gap-2 border-t border-border pt-4">
              <p className="text-sm font-medium">Tính năng</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PLAN_FEATURES.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={features[key] === true}
                      onCheckedChange={(v) => setFeatures((s) => ({ ...s, [key]: v === true }))}
                    />
                    {PLAN_FEATURE_LABEL[key]}
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
              {LIMIT_FIELDS.filter((f) => f.key !== 'monthly_price_vnd').map((f) => (
                <div key={f.key}>
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="font-medium">{plan[f.key as Exclude<LimitField, 'monthly_price_vnd'>]}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-1.5">
              {PLAN_FEATURES
                .filter((k) => plan.features[k] === true)
                .map((k) => (
                  <Badge key={k} variant="outline" className="text-[11px] font-normal">
                    {PLAN_FEATURE_LABEL[k]}
                  </Badge>
                ))}
              {Object.values(plan.features).every((v) => v !== true) && (
                <span className="text-sm text-muted-foreground">Không có tính năng mở rộng nào</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function toLimitForm(plan: PlatformPlan): Record<LimitField, string> {
  return {
    max_properties: String(plan.max_properties),
    max_rooms_per_property: String(plan.max_rooms_per_property),
    max_rooms: String(plan.max_rooms),
    max_users: String(plan.max_users),
    monthly_price_vnd: String(plan.monthly_price_vnd),
  };
}

function toFeatureForm(plan: PlatformPlan): Record<string, boolean> {
  return Object.fromEntries(
    PLAN_FEATURES.map((k) => [k, plan.features[k] === true]),
  );
}
