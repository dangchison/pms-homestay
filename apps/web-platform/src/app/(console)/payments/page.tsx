'use client';

import { useState } from 'react';
import Link from 'next/link';
import { type SubscriptionPaymentStatus } from '@pms/shared-types';
import { Badge, Button, Card, CardContent, Skeleton, toast } from '@pms/ui';
import { PageContainer, PageHeader } from '@/components/layout';
import { ApiClientError } from '@/lib/api-client';
import { dateTime, vnd } from '@/lib/format';
import { useConfirmPayment, usePayments } from '@/lib/hooks/use-platform';

const TABS: (SubscriptionPaymentStatus | 'ALL')[] = ['PENDING', 'CONFIRMED', 'CANCELLED', 'ALL'];

/**
 * Xác nhận thanh toán thuê bao bằng tay: khách chuyển khoản theo nội dung
 * `payment_ref`, admin đối chiếu sao kê rồi bấm xác nhận → tenant ACTIVE + gia hạn.
 */
export default function PaymentsPage() {
  const [tab, setTab] = useState<SubscriptionPaymentStatus | 'ALL'>('PENDING');
  const { data, isLoading } = usePayments(tab === 'ALL' ? undefined : tab);
  const confirm = useConfirmPayment();

  const onConfirm = async (id: string, ref: string) => {
    try {
      await confirm.mutateAsync(id);
      toast.success(`Đã xác nhận ${ref}`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Không xác nhận được');
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Thanh toán thuê bao"
        description="Đối chiếu sao kê theo nội dung chuyển khoản trước khi xác nhận — thao tác này gia hạn tenant."
      />

      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              t === tab
                ? 'rounded-md bg-muted px-3 py-1.5 text-sm font-medium'
                : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {t === 'ALL' ? 'Tất cả' : t}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {(data ?? []).map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <Link href={`/tenants/${p.tenant_id}`} className="hover:underline">
                        {p.tenant_display_name}
                      </Link>
                      <span className="ml-2 font-normal text-muted-foreground">{p.tenant_slug}</span>
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {p.payment_ref} · tạo {dateTime(p.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-sm">
                    <Badge variant="outline">{p.plan_code}</Badge>
                    <span className="font-medium">{vnd(p.amount_vnd)}</span>
                    <Badge variant={p.status === 'CONFIRMED' ? 'secondary' : 'outline'}>
                      {p.status}
                    </Badge>
                    {p.status === 'PENDING' && (
                      <Button
                        size="sm"
                        disabled={confirm.isPending}
                        onClick={() => onConfirm(p.id, p.payment_ref)}
                      >
                        Xác nhận
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {data?.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Không có thanh toán nào ở trạng thái này.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
