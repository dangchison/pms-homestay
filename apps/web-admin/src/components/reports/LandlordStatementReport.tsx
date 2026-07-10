'use client';

import { Skeleton } from '@pms/ui';
import type { LandlordSettlementModel } from '@pms/shared-types';
import { vnd } from '@/lib/format';
import { useLandlordStatement } from '@/lib/hooks/use-reports';
import { monthRange } from '@/lib/reports-period';

const SETTLEMENT: Record<LandlordSettlementModel, string> = {
  REVENUE_SHARE: 'Chia % doanh thu',
  FIXED_RENT: 'Thuê cố định',
  NONE: 'Chưa cấu hình',
};

const VN_DATE = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDate = (iso: string | null) => (iso ? VN_DATE.format(new Date(iso)) : '—');

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

/**
 * #14 Bảng kê chủ nhà gốc (rent-to-rent). Chỉ cơ sở `is_rent_to_rent`; với cơ sở
 * thường KHÔNG gọi API (tránh 422 NOT_RENT_TO_RENT) mà hiện hướng dẫn.
 */
export function LandlordStatementReport({
  propertyId,
  month,
  isRentToRent,
}: {
  propertyId: string;
  month: string;
  isRentToRent: boolean;
}) {
  const { from, to } = monthRange(month);
  const { data, isLoading } = useLandlordStatement(propertyId, from, to, isRentToRent);

  if (!isRentToRent) {
    return (
      <p className="text-sm text-muted-foreground">
        Cơ sở này không phải loại cho thuê lại (rent-to-rent) nên không có bảng kê chủ nhà. Bật
        &ldquo;Cho thuê lại&rdquo; và khai thông tin chủ nhà trong Cơ sở &amp; Phòng để dùng.
      </p>
    );
  }
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  const basis =
    data.settlement_model === 'REVENUE_SHARE' && data.revenue_share_bp != null
      ? `${(data.revenue_share_bp / 100).toFixed(2)}% doanh thu`
      : data.settlement_model === 'FIXED_RENT' && data.monthly_landlord_rent_vnd != null
        ? `${vnd(data.monthly_landlord_rent_vnd)}/tháng (prorate theo ngày)`
        : '—';

  const cards = [
    { label: 'Doanh thu kỳ', value: vnd(data.revenue_total_vnd), accent: false },
    { label: 'Chi phí vận hành', value: vnd(data.operating_cost_vnd), accent: false },
    { label: 'Chủ nhà nhận', value: vnd(data.landlord_payout_vnd), accent: true },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-sm font-medium">{data.property_name}</div>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Field label="Chủ nhà" value={data.landlord_name ?? '—'} />
          <Field label="Điện thoại" value={data.landlord_phone ?? '—'} />
          <Field label="Hợp đồng từ" value={fmtDate(data.contract_start)} />
          <Field label="Đến" value={fmtDate(data.contract_end)} />
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div
              className={`mt-1 text-lg font-semibold tabular-nums ${c.accent ? 'text-primary' : ''}`}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Mô hình thanh toán</span>
          <span className="font-medium">{SETTLEMENT[data.settlement_model]}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Cơ sở tính</span>
          <span className="tabular-nums">{basis}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Lấp đầy kỳ: {data.occupied_room_nights}/{data.available_room_nights} đêm-phòng (
        {data.occupancy_rate_pct.toFixed(1)}%). Chi phí vận hành KHÔNG gồm tiền thuê trả chủ nhà
        (tránh trùng).
      </p>
    </div>
  );
}
