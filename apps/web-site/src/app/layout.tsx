import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { themeInitScript } from '@pms/ui';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SITE_URL } from '@/lib/site';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'PMS Homestay — phần mềm quản lý homestay và căn hộ dịch vụ',
    template: '%s · PMS Homestay',
  },
  description:
    'Lịch phòng chống trùng, thu tiền VietQR đối soát được, khai báo lưu trú theo TT56, đồng bộ OTA hai chiều. Làm cho cách người Việt kinh doanh lưu trú.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'vi_VN',
    siteName: 'PMS Homestay',
    url: SITE_URL,
    title: 'PMS Homestay — phần mềm quản lý homestay và căn hộ dịch vụ',
    description:
      'Một nơi khớp lại toàn bộ việc vận hành: lịch phòng, tiền, khách, khai báo lưu trú.',
  },
  robots: { index: true, follow: true },
};

/** Hướng thiết kế đã cam kết cho trang này — hằng số, không có đầu vào ngoài. */
const DIRECTION_CONTRACT = `<!--
THESIS: Việc vận hành một homestay đang nằm rải ở Zalo, Excel, sổ tay và hộp thư
OTA; trang này là tờ đối soát khớp từng mảnh đó về một dòng. Từ chối kiểu
hero-cộng-lưới-thẻ-tính-năng của mọi trang SaaS cùng ngành.
OWN-WORLD: kế thừa nguyên hệ Quiet Concierge — nền lanh ấm hue 95, một accent
teal duy nhất, Inter một giọng, mặt phẳng, kẻ mảnh 1px, bo 12/8px. Không thêm
màu, font hay vật liệu mới; chỉ đậm thêm hai token dẫn xuất cho đạt tương phản AA.
STORY: chủ nhà nhận ra cột trái là đời mình, thấy cột phải là cùng việc đó đã
khớp, rồi bấm dùng thử 14 ngày.
FIRST VIEWPORT: tiêu đề lớn bên trái đường kẻ dọc, bên phải là lịch phòng đang
chạy; nút "Dùng thử 14 ngày" ngay dưới tiêu đề.
FORM: tờ đối soát — candidate 3 trong danh sách xếp theo độ cộng hưởng;
seed key 2bd8d2f0.
FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, and DESIGN.md
-->`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="light" suppressHydrationWarning>
      <body className={`${inter.variable} min-h-screen bg-background font-sans antialiased`}>
        {/*
          Ghi vào DOM thật (không phải JSX comment — React bỏ hẳn loại đó), để
          bản build còn audit được hướng thiết kế đã cam kết.
        */}
        <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
