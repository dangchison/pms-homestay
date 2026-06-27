import { type Page, expect } from '@playwright/test';

/**
 * Đăng nhập bằng nút demo 1-chạm (cần NEXT_PUBLIC_DEMO_MODE=1 + tenant `demo`
 * đã seed qua `pnpm db:seed:dev`). Chờ tới khi dashboard hiện.
 */
export async function loginDemo(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Dùng thử với tài khoản demo' }).click();
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
}
