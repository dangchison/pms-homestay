'use client';

import { useState } from 'react';
import Link from 'next/link';
import { type TenantStatus } from '@pms/shared-types';
import { Badge, Card, CardContent, Input, Skeleton } from '@pms/ui';
import { PageContainer, PageHeader } from '@/components/layout';
import { date } from '@/lib/format';
import { useTenants } from '@/lib/hooks/use-platform';

const STATUSES: (TenantStatus | 'ALL')[] = ['ALL', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'CHURNED'];

export default function TenantsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<TenantStatus | 'ALL'>('ALL');
  const { data, isLoading } = useTenants({
    q: q.trim() || undefined,
    status: status === 'ALL' ? undefined : status,
  });

  return (
    <PageContainer>
      <PageHeader
        title="Tenant"
        description="Số phòng và cơ sở nằm ở trang chi tiết — đếm được phải mở đúng ngữ cảnh tenant."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Tìm theo slug hoặc tên"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={
                s === status
                  ? 'rounded-md bg-muted px-3 py-1.5 text-sm font-medium'
                  : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
              }
            >
              {s === 'ALL' ? 'Tất cả' : s}
            </button>
          ))}
        </div>
        {data && <span className="text-sm text-muted-foreground">{data.total} tenant</span>}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {(data?.items ?? []).map((t) => (
                <Link
                  key={t.id}
                  href={`/tenants/${t.id}`}
                  className="flex items-center justify-between gap-4 p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.display_name}</p>
                    <p className="truncate text-sm text-muted-foreground">{t.slug}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-sm">
                    <span className="text-muted-foreground">Tạo {date(t.created_at)}</span>
                    <Badge variant="outline">{t.plan_code ?? 'chưa có gói'}</Badge>
                    <Badge variant="secondary">{t.status}</Badge>
                  </div>
                </Link>
              ))}
              {data?.items.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Không có tenant nào khớp bộ lọc.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
