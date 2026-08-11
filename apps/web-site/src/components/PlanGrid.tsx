import { type SubscriptionPlan } from '@pms/shared-types';
import { PLAN_FOR, PLAN_LABEL, REGISTER_URL, priceLabel } from '@/lib/site';

/**
 * Bảng giá đọc thẳng từ API nên số ở đây luôn là hạn mức hệ thống đang chặn
 * thật. API không trả được thì hiện lối liên hệ, tuyệt đối không viết cứng số —
 * bán một đằng chặn một nẻo là mất khách ngay ngày đầu.
 */
export function PlanGrid({ plans, compact = false }: { plans: SubscriptionPlan[]; compact?: boolean }) {
  if (plans.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface px-5 py-6 text-sm text-ink-2">
        Chưa tải được bảng giá. Gửi thư cho chúng tôi để nhận báo giá theo số phòng của bạn.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((p) => {
        const recommended = p.code === 'STARTER';
        return (
          <div
            key={p.id}
            className={`grid content-start gap-4 rounded-xl border bg-surface p-5 ${
              recommended ? 'border-primary' : 'border-border'
            }`}
          >
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">{PLAN_LABEL[p.code] ?? p.code}</h3>
                {recommended && (
                  <span className="rounded-sm bg-primary-muted px-2 py-0.5 text-xs font-medium text-foreground">
                    Phổ biến
                  </span>
                )}
              </div>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                  {priceLabel(p)}
                </span>
                {p.monthly_price_vnd > 0 && (
                  <span className="text-sm text-ink-2">/tháng</span>
                )}
              </p>
              {!compact && PLAN_FOR[p.code] && (
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  {PLAN_FOR[p.code]}
                </p>
              )}
            </div>

            <dl className="grid gap-1.5 border-t border-border pt-4 text-sm">
              <Limit label="Cơ sở" value={p.max_properties} />
              <Limit label="Phòng mỗi cơ sở" value={p.max_rooms_per_property} />
              <Limit label="Phòng tổng" value={p.max_rooms} />
              <Limit label="Tài khoản nhân viên" value={p.max_users} />
            </dl>

            <a
              href={REGISTER_URL}
              className={`mt-1 rounded-md px-4 py-2.5 text-center text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                recommended
                  ? 'bg-primary-strong text-primary-foreground hover:bg-primary-strong-hover'
                  : 'border border-input text-foreground hover:bg-primary-muted'
              }`}
            >
              {p.code === 'FREE' ? 'Bắt đầu miễn phí' : 'Dùng thử 14 ngày'}
            </a>
          </div>
        );
      })}
    </div>
  );
}

function Limit({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
