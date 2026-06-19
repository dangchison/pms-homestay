import * as Sentry from '@sentry/nextjs';

// Next instrumentation hook: nạp đúng config Sentry theo runtime (docs/11 §3).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

// Bắt lỗi nested React Server Components / route handler (App Router).
export const onRequestError = Sentry.captureRequestError;
