'use client';

import { Button } from '@pms/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-xl font-semibold">Có lỗi xảy ra</h1>
      <p className="text-sm text-muted-foreground">{error.digest ?? error.message}</p>
      <Button onClick={reset}>Thử lại</Button>
    </main>
  );
}
