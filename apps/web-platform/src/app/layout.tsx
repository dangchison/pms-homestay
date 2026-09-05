import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster, themeInitScript } from '@pms/ui';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Quản trị nền tảng', template: '%s · Quản trị nền tảng' },
  description: 'Cấu hình gói thuê bao, tenant và thanh toán PMS Homestay',
  // Console nội bộ — không bao giờ được lên kết quả tìm kiếm.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="light" suppressHydrationWarning>
      <body className={`${inter.variable} min-h-screen font-sans antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
