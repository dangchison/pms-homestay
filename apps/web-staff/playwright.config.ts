import { defineConfig, devices } from '@playwright/test';

/**
 * E2E web-staff (docs/18 P2-A2). PWA lễ tân/buồng phòng: smoke điều hướng theo vai
 * + luồng check-in + offline shell (service worker).
 *
 * - LOCAL: cần stack đang chạy. SW chỉ đăng ký ở **production build** (next start),
 *   nên để test offline chạy thật, build trước: `pnpm --filter @pms/web-staff build`
 *   rồi để Playwright tự `pnpm start` (port 3002). Nếu đang chạy `next dev`,
 *   `reuseExistingServer` tái dùng nó nhưng SW tắt → test offline tự skip.
 * - CI: api (node dist/main.js) + web-staff (next start) do Playwright tự khởi động;
 *   stack PG/Redis + migrate + seed:dev đã làm ở các step trước (ci.yml e2e-web-staff).
 *
 * Mobile-first: chạy trên profile Pixel 5 (web-staff thiết kế cho 360–430px).
 */
const CI = !!process.env.CI;
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3002';

export default defineConfig({
  testDir: './e2e',
  // Tuần tự + 1 worker: luồng check-in có thể mutate dữ liệu seed → tránh đua nhau.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'vi-VN',
  },
  // Profile điện thoại (web-staff là PWA một tay) — service worker bật ở chromium.
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }],
  webServer: [
    {
      // API: tái dùng nếu đang chạy (local); CI tự start từ bản build.
      command: 'node dist/main.js',
      cwd: '../api',
      url: 'http://localhost:3001/health/liveness',
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { ENABLE_SCHEDULERS: 'false' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // web-staff: local reuse nếu đã chạy; CI chạy `next start` từ bản build
      // (NEXT_PUBLIC_* đã bake lúc build trong CI).
      command: 'pnpm start',
      url: BASE_URL,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
