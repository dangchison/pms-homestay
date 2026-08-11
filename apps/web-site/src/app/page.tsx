import Link from 'next/link';
import { LedgerRow } from '@/components/LedgerRow';
import { PlanGrid } from '@/components/PlanGrid';
import {
  ArrivalsToday,
  CalendarStrip,
  ChannelSync,
  CheckinScan,
  PaymentMatch,
  PnlRows,
  Scrap,
  Surface,
} from '@/components/pieces';
import { REGISTER_URL, SITE_URL, fetchPlansOrEmpty } from '@/lib/site';

export const revalidate = 3600;

export default async function HomePage() {
  const plans = await fetchPlansOrEmpty();

  return (
    <main>
      <Hero />

      <section className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="divide-y divide-border">
          <LedgerRow
            job="Nhận đặt phòng"
            pain="Một khách nhắn Zalo, một khách qua Booking.com, một khách gọi điện lúc bạn đang dọn phòng. Ba nơi, không nơi nào biết nơi kia vừa bán mất đêm nào."
            scraps={
              <>
                <Scrap kind="zalo" from="Zalo" tilt={-0.6} index={0}>
                  “Chị ơi cuối tuần này còn phòng đôi không ạ?”
                </Scrap>
                <Scrap kind="mail" from="Hộp thư" tilt={0.5} index={1}>
                  New booking · 14–16/08 · Deluxe Double
                </Scrap>
                <Scrap kind="giay" from="Sổ tay để ở quầy" tilt={-0.4} index={2}>
                  “A. Phạm — 202 — 12/8 — đã cọc 500k”
                </Scrap>
              </>
            }
            surface={
              <Surface label="Ba nguồn đặt, một lịch — nguồn nào vào chỗ nấy">
                <ArrivalsToday />
              </Surface>
            }
          />

          <LedgerRow
            job="Thu tiền"
            pain="Khách gửi ảnh chuyển khoản qua Zalo. Bạn mở app ngân hàng dò xem tiền về chưa, rồi gõ tay vào Excel. Cuối tháng không ai dám chắc dòng nào đã thu, dòng nào chưa."
            scraps={
              <>
                <Scrap kind="zalo" from="Zalo" tilt={0.7} index={0}>
                  Ảnh chụp màn hình chuyển khoản, không đọc được nội dung
                </Scrap>
                <Scrap kind="excel" from="Bảng tính thu chi" tilt={-0.5} index={1}>
                  Dòng 214 · “2tr4 — phòng 202 — chắc là rồi?”
                </Scrap>
              </>
            }
            surface={
              <Surface label="Hoá đơn, VietQR và đối soát ngân hàng">
                <PaymentMatch />
              </Surface>
            }
          />

          <LedgerRow
            job="Khách đến nhận phòng"
            pain="Chụp CCCD để đấy rồi tối ngồi gõ lại. Khai báo lưu trú thì nhớ ra lúc nào làm lúc đó, và không ai muốn nghĩ tới chuyện đoàn kiểm tra hỏi sổ."
            scraps={
              <>
                <Scrap kind="giay" from="Điện thoại" tilt={-0.8} index={0}>
                  47 ảnh CCCD trong thư mục ảnh, chưa nhập cái nào
                </Scrap>
                <Scrap kind="excel" from="Sổ khai báo lưu trú" tilt={0.6} index={1}>
                  Gõ tay từng khách, mỗi người khoảng 3 phút
                </Scrap>
              </>
            }
            surface={
              <Surface label="Quét CCCD, tờ khai TT56 sinh sẵn">
                <CheckinScan />
              </Surface>
            }
          />

          <LedgerRow
            job="Cuối tháng, đếm xem còn lại bao nhiêu"
            pain="Cộng doanh thu thì dễ. Nhưng trừ hoa hồng OTA, tiền thuê nhà, điện nước, vật tư và khấu hao cái máy giặt mua năm ngoái, thì con số lãi thật nằm ở đâu?"
            scraps={
              <>
                <Scrap kind="excel" from="Bảng tính doanh thu" tilt={0.4} index={0}>
                  Tổng thu tháng 8 · 84.600.000 — chưa trừ gì
                </Scrap>
                <Scrap kind="giay" from="Tập hoá đơn kẹp ở ngăn kéo" tilt={-0.7} index={1}>
                  Điện, nước, ga, giặt là, sửa điều hoà phòng 201
                </Scrap>
              </>
            }
            surface={
              <Surface label="Báo cáo lãi lỗ, có cả chi phí và khấu hao">
                <PnlRows />
              </Surface>
            }
          />

          <LedgerRow
            job="Giữ lịch khớp với các kênh OTA"
            pain="Bán được một đêm là phải nhớ vào từng kênh chặn tay. Quên một lần thì thành hai khách một phòng, và người xin lỗi lúc nửa đêm là bạn."
            scraps={
              <>
                <Scrap kind="mail" from="Extranet Booking.com" tilt={-0.5} index={0}>
                  Chặn phòng 202 · 14–16/08 · làm tay
                </Scrap>
                <Scrap kind="mail" from="Airbnb" tilt={0.6} index={1}>
                  Chặn phòng 202 · 14–16/08 · làm tay, lần nữa
                </Scrap>
              </>
            }
            surface={
              <Surface label="Đồng bộ iCal hai chiều">
                <ChannelSync />
              </Surface>
            }
          />
        </div>

        <p className="pb-4 text-xs text-ink-2">
          Tên khách, số tiền và mã hoá đơn ở trên là dữ liệu minh hoạ.
        </p>
      </section>

      <Compliance />

      <Pricing plans={plans} />

      <Faq />

      <CloseCta />

      <StructuredData />
    </main>
  );
}

/* ─────────────────────────────── Mở đầu ─────────────────────────────── */

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-5 pt-14 pb-10 md:px-8 md:pt-20 md:pb-14">
      {/* KHÔNG bọc Reconcile: khối này đã ở trong tầm mắt lúc tải. */}
      <div className="relative grid items-center gap-10 md:grid-cols-2 md:gap-14">
        <span
          aria-hidden
          className="ledger-rule absolute inset-y-0 left-1/2 hidden w-px md:block"
        />

        <div className="md:pr-4">
          <h1 className="text-[2.125rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance md:text-5xl">
            Việc của bạn đang nằm ở bốn nơi. Đây là chỗ nó khớp lại.
          </h1>
          <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-ink-2 md:text-[17px]">
            Lịch phòng, tiền khách trả, tờ khai lưu trú và con số lãi cuối tháng — một hệ thống
            làm cho cách người Việt kinh doanh lưu trú, không phải bản dịch của phần mềm nước
            ngoài.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={REGISTER_URL}
              className="rounded-md bg-primary-strong px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-strong-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Dùng thử 14 ngày
            </a>
            <Link
              href="/bang-gia"
              className="rounded-md border border-input px-5 py-3 text-sm font-medium transition-colors hover:bg-primary-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Xem bảng giá
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-2">
            Không cần thẻ. Hết dùng thử, tài khoản chuyển về gói miễn phí và dữ liệu vẫn còn.
          </p>
        </div>

        <div className="md:pl-4">
          <Surface label="Lịch phòng — màn hình bạn mở nhiều nhất mỗi ngày" still>
            <CalendarStrip rooms={6} />
          </Surface>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── Tuân thủ pháp lý VN ────────────────────────── */

const COMPLIANCE = [
  {
    title: 'Khai báo lưu trú theo Thông tư 56',
    body: 'Thông tin khách nhập một lần lúc nhận phòng là đủ để xuất tờ khai, không phải chép lại sang sổ khác.',
  },
  {
    title: 'Đọc CCCD gắn chip',
    body: 'Chụp mặt trước để hệ thống điền sẵn họ tên, số định danh, ngày sinh, thường trú; lễ tân soát lại rồi xác nhận. Đỡ gõ, và đỡ gõ sai.',
  },
  {
    title: 'VietQR và đối soát ngân hàng',
    body: 'Mã QR sinh theo đúng hoá đơn. Tiền về khớp vào đúng dòng, không phải dò ảnh chuyển khoản.',
  },
  {
    title: 'Quyền dữ liệu cá nhân theo Nghị định 13',
    body: 'Khách yêu cầu bản sao hoặc yêu cầu xoá dữ liệu thì có sẵn đường để làm, có ghi vết.',
  },
  {
    title: 'Khai báo tạm trú người nước ngoài',
    body: 'Mẫu khai cho khách nước ngoài nằm ngay trong luồng nhận phòng.',
  },
  {
    title: 'Dữ liệu từng cơ sở tách bạch',
    body: 'Mỗi tài khoản chỉ thấy dữ liệu của mình. Ranh giới này được kiểm bằng test tự động chạy xen kẽ hai tenant.',
  },
] as const;

function Compliance() {
  return (
    <section className="border-y border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
        <h2 className="max-w-[24ch] text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          Phần mà phần mềm nước ngoài không làm cho bạn
        </h2>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
          Một PMS nhập khẩu quản lý phòng rất tốt, rồi để lại cho bạn toàn bộ phần giấy tờ Việt
          Nam. Phần đó nằm sẵn ở đây.
        </p>
        <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {COMPLIANCE.map((c) => (
            <div key={c.title}>
              <dt className="text-[15px] font-medium">{c.title}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-ink-2">{c.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ──────────────────────────────── Giá ──────────────────────────────── */

async function Pricing({ plans }: { plans: Awaited<ReturnType<typeof fetchPlansOrEmpty>> }) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Giá theo số phòng</h2>
          <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
            Trả theo quy mô thật của bạn. Đổi gói lúc nào cũng được, không hợp đồng ràng buộc.
          </p>
        </div>
        <Link
          href="/bang-gia"
          className="text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
        >
          So sánh chi tiết
        </Link>
      </div>
      <div className="mt-10">
        <PlanGrid plans={plans} compact />
      </div>
    </section>
  );
}

/* ──────────────────────────────── FAQ ──────────────────────────────── */

const FAQ = [
  {
    q: 'Tôi đang dùng Excel, chuyển sang có mất dữ liệu cũ không?',
    a: 'Không. Bạn cứ giữ nguyên file Excel và chạy song song một tháng đầu. Hệ thống không đòi bạn nhập lại lịch sử — bắt đầu từ những booking sắp tới là đủ để so hai bên xem con số có khớp.',
  },
  {
    q: 'Hết 14 ngày dùng thử thì sao?',
    a: 'Tài khoản chuyển về gói miễn phí, dữ liệu giữ nguyên. Nếu lúc đó bạn đã tạo nhiều phòng hơn hạn mức gói miễn phí, những phòng đó vẫn xem và vận hành được, chỉ là không tạo thêm được cho tới khi nâng gói.',
  },
  {
    q: 'Nhân viên lễ tân và buồng phòng có dùng được không?',
    a: 'Có, bằng một ứng dụng riêng trên điện thoại: xem việc hôm nay, đổi trạng thái phòng, làm được cả khi mạng chập chờn. Quyền hạn tách theo vai trò, nhân viên không nhìn thấy báo cáo tài chính.',
  },
  {
    q: 'Đồng bộ được với những kênh nào?',
    a: 'Bất kỳ kênh nào hỗ trợ iCal hai chiều — Booking.com, Airbnb, Agoda và phần lớn OTA khác. Lịch phòng là nguồn duy nhất, các kênh đọc và ghi về đó.',
  },
  {
    q: 'Dữ liệu khách của tôi nằm ở đâu?',
    a: 'Trên hạ tầng chúng tôi vận hành, tách bạch theo từng tài khoản ở tầng cơ sở dữ liệu. Bạn xuất được dữ liệu của mình bất cứ lúc nào, và yêu cầu xoá theo Nghị định 13 có đường xử lý sẵn.',
  },
] as const;

function Faq() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Câu hỏi hay gặp</h2>
        <dl className="mt-10 grid max-w-3xl divide-y divide-border">
          {FAQ.map((f) => (
            <div key={f.q} className="grid gap-2 py-6 first:pt-0">
              <dt className="text-[15px] font-medium">{f.q}</dt>
              <dd className="max-w-[68ch] text-sm leading-relaxed text-ink-2">{f.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ─────────────────────────────── Kết ─────────────────────────────── */

function CloseCta() {
  return (
    <section className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-5 py-16 text-center md:px-8 md:py-24">
        <h2 className="mx-auto max-w-[22ch] text-2xl font-semibold tracking-tight text-balance md:text-4xl">
          Mở tài khoản, dựng cơ sở đầu tiên trong buổi sáng nay.
        </h2>
        <p className="mx-auto mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
          Không cần thẻ, không cần gọi tư vấn. Nếu không hợp, bạn đóng lại và không mất gì.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href={REGISTER_URL}
            className="rounded-md bg-primary-strong px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-strong-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Dùng thử 14 ngày
          </a>
          <Link
            href="/lien-he"
            className="rounded-md border border-input px-6 py-3 text-sm font-medium transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Nói chuyện với người thật
          </Link>
        </div>
      </div>
    </section>
  );
}

function StructuredData() {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'PMS Homestay',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: 'vi-VN',
    url: SITE_URL,
    description:
      'Phần mềm quản lý homestay, căn hộ dịch vụ và rent-to-rent tại Việt Nam: lịch phòng chống trùng, VietQR đối soát, khai báo lưu trú TT56, đồng bộ OTA hai chiều.',
  };
  return (
    <script
      type="application/ld+json"
      // Dữ liệu tĩnh do chính trang này định nghĩa, không có đầu vào người dùng.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
