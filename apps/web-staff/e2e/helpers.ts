import { type Page, expect } from '@playwright/test';

export type StaffRole = 'reception' | 'housekeeper';

const LANDING: Record<StaffRole, { button: string; heading: string }> = {
  reception: { button: 'Lễ tân', heading: 'Hôm nay' }, // STAFF → /today
  housekeeper: { button: 'Buồng phòng', heading: 'Dọn phòng' }, // HOUSEKEEPER → /cleaning
};

/**
 * Đăng nhập bằng nút demo 1-chạm (cần NEXT_PUBLIC_DEMO_MODE=1 + tenant `demo` đã
 * seed qua `pnpm db:seed:dev`). Chờ tới khi trang chủ theo vai hiện.
 */
export async function loginDemo(page: Page, role: StaffRole): Promise<void> {
  const { button, heading } = LANDING[role];
  await page.goto('/login');
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}
