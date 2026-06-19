'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Global error boundary (App Router) — bắt lỗi render React ở tầng root layout
 * và gửi lên Sentry (docs/11 §3). Chỉ kích hoạt khi lỗi nghiêm trọng làm vỡ cả
 * root layout; thay thế toàn bộ document nên phải tự render <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="vi">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <h2>Đã xảy ra lỗi</h2>
        <p>Hệ thống đã ghi nhận sự cố. Vui lòng thử lại.</p>
        <button type="button" onClick={() => reset()}>
          Thử lại
        </button>
      </body>
    </html>
  );
}
