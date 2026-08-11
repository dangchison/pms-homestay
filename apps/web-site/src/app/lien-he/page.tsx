import type { Metadata } from 'next';
import { CONTACT, REGISTER_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Liên hệ',
  description: 'Hỏi trước khi dùng thử, hoặc cần báo giá cho chuỗi nhiều cơ sở.',
  alternates: { canonical: '/lien-he' },
};

const TEMPLATE = `Chào PMS Homestay,

Cơ sở của tôi:
- Số cơ sở:
- Số phòng mỗi cơ sở:
- Đang quản lý bằng:
- Kênh đang bán (Booking.com, Airbnb, khách trực tiếp…):

Câu hỏi của tôi:
`;

/**
 * Không dựng form. Form gửi đi đâu đó chưa tồn tại thì tệ hơn không có form:
 * khách bấm gửi, tin là đã tới nơi, rồi không ai trả lời. Khi có endpoint nhận
 * lead thật thì thay chỗ này.
 */
export default function ContactPage() {
  const mailto = CONTACT.email
    ? `mailto:${CONTACT.email}?subject=${encodeURIComponent('Hỏi về PMS Homestay')}&body=${encodeURIComponent(TEMPLATE)}`
    : null;

  return (
    <main className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
      <div className="grid gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <h1 className="max-w-[18ch] text-3xl font-semibold tracking-tight text-balance md:text-4xl">
            Hỏi trước cũng được
          </h1>
          <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">
            Nếu bạn muốn biết hệ thống có hợp với cách mình đang làm không, hoặc cần báo giá cho
            chuỗi nhiều cơ sở, cứ viết thư. Nói giúp số cơ sở và số phòng thì chúng tôi trả lời
            được cụ thể ngay lần đầu.
          </p>

          {mailto ? (
            <a
              href={mailto}
              className="mt-8 inline-block rounded-md bg-primary-strong px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-strong-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Viết thư cho chúng tôi
            </a>
          ) : (
            <p className="mt-8 text-sm text-ink-2">
              Địa chỉ liên hệ đang được cập nhật.
            </p>
          )}

          {CONTACT.phone && (
            <p className="mt-4 text-sm text-ink-2">
              Hoặc gọi{' '}
              <a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`} className="text-foreground underline decoration-border underline-offset-4">
                {CONTACT.phone}
              </a>
            </p>
          )}
        </div>

        <div className="grid content-start gap-6 rounded-xl border border-border bg-surface p-6">
          <div>
            <h2 className="text-[15px] font-medium">Không cần chờ trả lời mới bắt đầu</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              Tài khoản mở ngay, dùng thử đầy đủ 14 ngày, không cần thẻ. Dựng thử một cơ sở với
              vài phòng thật rồi tự đánh giá còn nhanh hơn hỏi.
            </p>
            <a
              href={REGISTER_URL}
              className="mt-4 inline-block rounded-md border border-input px-4 py-2.5 text-sm font-medium transition-colors hover:bg-primary-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Mở tài khoản
            </a>
          </div>

          <div className="border-t border-border pt-6">
            <h2 className="text-[15px] font-medium">Đang là khách hàng?</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              Hỗ trợ kỹ thuật đi qua cùng địa chỉ thư ở trên. Ghi kèm tên cơ sở để tra nhanh.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
