import { defineConfig, devices } from '@playwright/test';

/**
 * E2E web-admin (docs/18 P2-A1). Chạy smoke điều hướng + 1 flow ghi (thu tiền).
 *
 * - LOCAL: cần stack đang chạy (`pnpm db:up && pnpm dev`) — `reuseExistingServer`
 *   sẽ tái dùng api :3001 + web :3000 đang chạy, không tự build.
 * - CI: api (node dist/main.js) + web (next start) do Playwright tự khởi động;
 *   stack PG/Redis + migrate + seed:dev đã làm ở các step trước (ci.yml).
 */
const CI = !!process.env.CI;
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // Tuần tự + 1 worker: flow thu tiền mutate dữ liệu seed → tránh đua nhau.
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
      // web-admin: local reuse `next dev`; CI chạy `next start` từ bản build
      // (NEXT_PUBLIC_* đã bake lúc build trong CI).
      command: 'pnpm start',
      url: BASE_URL,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
