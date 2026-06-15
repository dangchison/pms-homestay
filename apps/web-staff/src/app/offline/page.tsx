'use client';

import { Button } from '@pms/ui';
import { RefreshCw, WifiOff } from 'lucide-react';

/**
 * T9 /offline — fallback khi mở route chưa cache lúc offline (Workbox navigation
 * fallback). Hướng dẫn + nút thử lại.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-muted">
        <WifiOff className="size-8 text-muted-foreground" />
      </span>
      <h1 className="text-xl font-semibold">Đang offline</h1>
      <p className="text-sm text-muted-foreground">
        Trang này chưa được tải về để xem offline. Hãy kết nối mạng rồi thử lại — các trang đã mở
        trước đó vẫn xem được.
      </p>
      <Button className="h-12" onClick={() => window.location.reload()}>
        <RefreshCw className="size-4" />
        Thử lại
      </Button>
    </main>
  );
}
