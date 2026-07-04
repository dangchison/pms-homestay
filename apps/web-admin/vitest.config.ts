import { defineConfig } from 'vitest/config';

/**
 * Unit tests web-admin (Đợt 1 / task 1.2): hooks TanStack Query + helpers PII mask.
 * Chỉ chạy `src/lib/**` (e2e Playwright ở `e2e/`, KHÔNG để vitest bắt). jsdom cho
 * `renderHook`; alias `@` khớp tsconfig; test file dùng React.createElement (không
 * JSX) nên KHÔNG cần plugin react.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
