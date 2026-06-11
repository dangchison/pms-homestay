import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@pms/ui';
import { Providers } from './providers';
import './globals.css';

// Font hệ thống: Inter latin + vietnamese (docs/ui/00 §3)
const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'PMS Homestay', template: '%s · PMS Homestay' },
  description: 'Quản lý homestay, căn hộ dịch vụ, rent-to-rent',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={`${inter.variable} min-h-screen font-sans antialiased`}>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
