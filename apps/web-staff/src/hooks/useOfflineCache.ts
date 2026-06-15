'use client';

import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/**
 * ★ READ-CACHE ONLY (docs/13 §4): hook trả trạng thái mạng để UI disable mutation
 * + hiện OfflineBanner khi offline. Cặp với service worker (public/sw.js) cache GET.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
