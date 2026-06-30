import { test, expect } from '@playwright/test';

/**
 * PWA offline shell (docs/18 P2-A2, docs/13 §4). Service worker (`/sw.js`) precache
 * app shell + navigation fallback `/offline`. SW **chỉ đăng ký ở production build**
 * (`next start`) — chạy `next dev` thì test tự skip.
 *
 * Chứng minh "offline shell hoạt động": (1) SW kiểm soát trang; (2) mở route chưa
 * cache lúc offline → trang `/offline` (không phải lỗi trình duyệt net::ERR...).
 */
test.describe('web-staff PWA — offline', () => {
  test('service worker kiểm soát trang + fallback /offline khi mở route chưa cache', async ({
    page,
    context,
  }) => {
    await page.goto('/login');

    // SW đăng ký ở sự kiện `load` (chỉ production build). Chờ tới khi nó kiểm soát trang.
    const swActive = await page
      .waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!swActive, 'Service worker chỉ đăng ký ở production build (next start) — bỏ qua khi dev.');

    // Ngắt mạng → mở route CHƯA cache → SW trả app shell /offline (network-first fallback).
    await context.setOffline(true);
    await page.goto('/e2e-route-chua-cache');
    await expect(page.getByRole('heading', { name: 'Đang offline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();

    await context.setOffline(false);
  });
});
