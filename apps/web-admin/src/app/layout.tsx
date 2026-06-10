import type { Metadata } from 'next';
import { Toaster } from '@pms/ui';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PMS Homestay', template: '%s · PMS Homestay' },
  description: 'Quản lý homestay, căn hộ dịch vụ, rent-to-rent',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
