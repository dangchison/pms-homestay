import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Toaster, themeInitScript } from '@pms/ui';
import './globals.css';

// Font hệ thống: Inter latin + vietnamese (docs/ui/00 §3); ≥16px tránh zoom iOS
const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'PMS Staff', template: '%s · PMS Staff' },
  description: 'App lễ tân & buồng phòng',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0d9488',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="light" suppressHydrationWarning>
      <body className={`${inter.variable} min-h-screen font-sans antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
