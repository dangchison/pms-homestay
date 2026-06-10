import type { Metadata, Viewport } from 'next';
import { Toaster } from '@pms/ui';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PMS Staff', template: '%s · PMS Staff' },
  description: 'App lễ tân & buồng phòng',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#1e40af',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
