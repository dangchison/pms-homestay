'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { bootstrapSession } from '@/lib/auth';
import { useEvents } from '@/lib/hooks/use-events';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Cổng auth cho khu dashboard (docs/13 §3): bootstrap phiên (thử refresh từ cookie
 * HttpOnly) khi mở app; `unauthenticated` → redirect /login; `idle` → màn chờ. Mount
 * `useEvents` (SSE) cho toàn dashboard. Client component vì access token in-memory.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useT();
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    void bootstrapSession();
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  useEvents(); // no-op cho tới khi có access token

  if (status !== 'authenticated') {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }
  return <>{children}</>;
}
