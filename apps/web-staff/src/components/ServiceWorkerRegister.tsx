'use client';

import { useEffect } from 'react';

/**
 * Đăng ký service worker PWA (ui/02 §PWA). SW (`/sw.js`) precache app shell +
 * runtime cache GET list (stale-while-revalidate) + navigation fallback `/offline`.
 * Chỉ chạy ở production build (dev tắt để tránh cache HMR). Mount 1 lần ở root.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* SW không bắt buộc — app vẫn chạy online bình thường */
      });
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);
  return null;
}
