import type { Metadata } from 'next';
import Link from 'next/link';
import { REGISTER_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Tính năng',
  description:
    'Lịch phòng chống trùng, vòng đời booking, hoá đơn và VietQR, chi phí và P&L, đồng bộ OTA, dọn phòng, tuân thủ pháp lý Việt Nam.',
  alternates: { canonical: '/tinh-nang' },
};

/**
 * Nhóm theo việc chủ nhà phải làm, không theo module kỹ thuật. Người đọc trang
 * này đang hỏi "nó có làm được việc của tôi không", không hỏi kiến trúc.
 */
const GROUPS = [
  {
    title: 'Lịch phòng và đặt phòng',
    lead: 'Màn hình bạn mở nhiều nhất. Gần như mọi việc thường ngày làm ngay trên đó, không phải rời trang.',
    items: [
      ['Chống trùng phòng', 'Hai người cùng đặt một phòng cho cùng một đêm thì hệ thống chặn ở tầng cơ sở dữ liệu, không phải chặn bằng lời nhắc.'],
      ['Vòng đời booking', 'Giữ chỗ có hạn, xác nhận, nhận phòng, trả phòng, đổi phòng giữa chừng — mỗi bước ghi lại ai làm và lúc nào.'],
      ['Giữ chỗ tự hết hạn', 'Khách hẹn cọc mà không cọc thì phòng tự mở lại, không cần bạn nhớ.'],
      ['Chặn phòng', 'Sửa chữa, để trống, dùng riêng — đánh dấu để không ai bán nhầm.'],
    ],
  },
  {
    title: 'Tiền',
    lead: 'Con số phải đối soát được. Đây là lý do phần mềm này tồn tại.',
    items: [
      ['Hoá đơn và cọc', 'Hoá đơn cọc và hoá đơn lưu trú sinh theo booking, có số chứng từ liên tục không nhảy cóc.'],
      ['VietQR', 'Mã QR sinh theo đúng số tiền và nội dung của từng hoá đơn.'],
      ['Đối soát tự động', 'Ngân hàng báo về là khớp thẳng vào hoá đơn. Khoản không khớp được đưa vào danh sách chờ xử lý tay, không biến mất.'],
      ['Bàn giao ca quầy', 'Đầu ca đếm tiền mặt, cuối ca đếm lại, hệ thống chỉ ra chênh lệch bao nhiêu và từ đâu.'],
      ['Chi phí, tài sản, khấu hao', 'Tiền thuê nhà, điện nước, vật tư, và tài sản khấu hao dần — để con số lãi là lãi thật.'],
      ['Báo cáo lãi lỗ', 'Theo cơ sở hoặc hợp nhất nhiều cơ sở. Xuất được để đưa kế toán.'],
    ],
  },
  {
    title: 'Khách và giấy tờ',
    lead: 'Nhập một lần lúc nhận phòng, dùng cho mọi thứ về sau.',
    items: [
      ['Đọc CCCD gắn chip', 'Chụp mặt trước là ra họ tên, số định danh, ngày sinh, thường trú.'],
      ['Khai báo lưu trú TT56', 'Tờ khai sinh từ dữ liệu đã nhập, không phải chép lại sang sổ khác.'],
      ['Khách nước ngoài', 'Mẫu khai tạm trú cho người nước ngoài nằm trong cùng luồng nhận phòng.'],
      ['Quyền dữ liệu theo NĐ13', 'Khách xin bản sao dữ liệu hoặc yêu cầu xoá thì có sẵn đường xử lý và có ghi vết.'],
      ['Hồ sơ khách quay lại', 'Lần sau khách tới, thông tin đã có sẵn.'],
    ],
  },
  {
    title: 'Kênh bán và vận hành',
    lead: 'Một lịch, nhiều nơi bán, một đội cùng nhìn một bảng.',
    items: [
      ['Đồng bộ OTA hai chiều', 'iCal với Booking.com, Airbnb, Agoda và các kênh khác. Lịch phòng là nguồn duy nhất.'],
      ['Cảnh báo xung đột', 'Kênh ngoài đẩy về một đêm đã bán thì hệ thống báo ngay thay vì ghi đè im lặng.'],
      ['Dọn phòng', 'Trạng thái phòng và việc dọn hiện trên điện thoại nhân viên, đánh dấu xong ngay tại chỗ.'],
      ['Ứng dụng cho nhân viên', 'Chạy trên điện thoại, làm được cả khi mạng chập chờn, nút to để thao tác một tay.'],
      ['Phân quyền theo vai trò', 'Lễ tân, buồng phòng, kế toán, chủ — mỗi người thấy đúng phần của mình.'],
      ['Thông báo realtime', 'Dữ liệu tự cập nhật trên màn hình, không phải bấm tải lại.'],
    ],
  },
  {
    title: 'Giá phòng',
    lead: 'Giá theo mùa, theo ngày trong tuần, theo độ dài lưu trú.',
    items: [
      ['Bảng giá theo mùa và ngày lễ', 'Lịch lễ Việt Nam có sẵn trong hệ thống, không phải tự nhớ Tết rơi vào ngày nào.'],
      ['Giảm theo độ dài lưu trú', 'Ở càng dài giá đêm càng mềm, đặt luật một lần rồi thôi.'],
      ['Mã giảm giá', 'Voucher có hạn dùng và số lượt, chống dùng quá số lần.'],
      ['Báo giá', 'Gửi báo giá cho khách đoàn trước khi chốt booking.'],
    ],
  },
] as const;

export default function FeaturesPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
      <h1 className="max-w-[22ch] text-3xl font-semibold tracking-tight text-balance md:text-4xl">
        Đủ để chạy một cơ sở thật, không phải bản demo
      </h1>
      <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-ink-2">
        Sắp theo việc bạn phải làm trong ngày, không theo tên module.
      </p>

      <div className="mt-14 grid divide-y divide-border">
        {GROUPS.map((g) => (
          <section key={g.title} className="grid gap-8 py-12 first:pt-0 md:grid-cols-[16rem_1fr] md:gap-14">
            <div className="md:sticky md:top-24 md:self-start">
              <h2 className="text-xl font-semibold tracking-tight">{g.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{g.lead}</p>
            </div>
            <dl className="grid gap-x-10 gap-y-7 sm:grid-cols-2">
              {g.items.map(([name, body]) => (
                <div key={name}>
                  <dt className="text-[15px] font-medium">{name}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-ink-2">{body}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <div className="mt-16 flex flex-wrap items-center gap-3 border-t border-border pt-10">
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
          Xem gói nào có gì
        </Link>
      </div>
    </main>
  );
}
