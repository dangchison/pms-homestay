import type { Metadata } from 'next';
import { PLAN_FEATURES, PLAN_FEATURE_LABEL, type SubscriptionPlan } from '@pms/shared-types';
import { PlanGrid } from '@/components/PlanGrid';
import { PLAN_LABEL, fetchPlans } from '@/lib/site';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Bảng giá',
  description:
    'Bốn gói theo số phòng: miễn phí, Khởi nghiệp, Chuyên nghiệp, Doanh nghiệp. Đổi gói lúc nào cũng được.',
  alternates: { canonical: '/bang-gia' },
};

export default async function PricingPage() {
  const plans = await fetchPlans();

  return (
    <main className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
      <h1 className="max-w-[20ch] text-3xl font-semibold tracking-tight text-balance md:text-4xl">
        Trả theo số phòng bạn thực sự đang chạy
      </h1>
      <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-ink-2">
        Mọi gói đều dùng thử đầy đủ 14 ngày ở mức Khởi nghiệp. Hết hạn, tài khoản chuyển về gói
        miễn phí và dữ liệu vẫn còn nguyên.
      </p>

      <div className="mt-12">
        <PlanGrid plans={plans} />
      </div>

      {plans.length > 0 && <FeatureMatrix plans={plans} />}

      <section className="mt-16 grid gap-6 border-t border-border pt-10 sm:grid-cols-2 lg:grid-cols-3">
        <Note title="Vượt hạn mức thì sao?">
          Dữ liệu đã có giữ nguyên, bạn vẫn xem và vận hành bình thường. Hệ thống chỉ chặn tạo
          thêm cơ sở hoặc phòng mới cho tới khi nâng gói.
        </Note>
        <Note title="Đổi gói giữa chừng?">
          Được, bất cứ lúc nào. Nâng gói có hiệu lực ngay sau khi thanh toán được xác nhận.
        </Note>
        <Note title="Thanh toán thế nào?">
          Chuyển khoản qua VietQR. Hệ thống sinh mã QR đúng số tiền và nội dung, xác nhận xong là
          gói mới chạy.
        </Note>
      </section>
    </main>
  );
}

/**
 * Bảng tick tính năng dựng từ chính cột `features` của gói — không viết tay danh
 * sách song song, để bảng giá không bao giờ hứa thứ hệ thống đang chặn.
 */
function FeatureMatrix({ plans }: { plans: SubscriptionPlan[] }) {
  const rows = PLAN_FEATURES.filter((f) => plans.some((p) => p.features[f] === true));
  if (rows.length === 0) return null;

  return (
    <section className="mt-16">
      <h2 className="text-xl font-semibold tracking-tight">Gói nào có gì</h2>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-3 pr-4 text-left font-medium">
                Tính năng
              </th>
              {plans.map((p) => (
                <th key={p.id} scope="col" className="px-3 py-3 text-center font-medium">
                  {PLAN_LABEL[p.code] ?? p.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f} className="border-b border-border">
                <th scope="row" className="py-3 pr-4 text-left font-normal text-ink-2">
                  <span className="first-letter:uppercase">{PLAN_FEATURE_LABEL[f]}</span>
                </th>
                {plans.map((p) => (
                  <td key={p.id} className="px-3 py-3 text-center">
                    {p.features[f] === true ? (
                      <>
                        <span aria-hidden className="inline-block size-1.5 rounded-full bg-primary" />
                        <span className="sr-only">Có</span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden className="text-ink-2">
                          —
                        </span>
                        <span className="sr-only">Không</span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[15px] font-medium">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}
