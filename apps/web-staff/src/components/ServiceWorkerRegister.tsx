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
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* SW không bắt buộc — app vẫn chạy online bình thường */
      });
    };
    // Trang có thể đã 'load' xong trước khi effect chạy (hydrate nhanh/bfcache) →
    // đăng ký ngay, tránh lỡ sự kiện 'load' khiến SW không bao giờ được đăng ký.
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);
  return null;
}
