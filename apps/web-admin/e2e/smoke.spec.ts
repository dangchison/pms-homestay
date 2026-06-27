import { test, expect } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Smoke điều hướng (docs/18 P2-A1): đăng nhập demo + các trang chính render đúng
 * — bắt lỗi FE trắng/vỡ mà typecheck/build không thấy.
 */
test.describe('web-admin smoke', () => {
  test('đăng nhập demo → dashboard có KPI', async ({ page }) => {
    await loginDemo(page);
    await expect(page.getByText('Khách đến hôm nay')).toBeVisible();
    await expect(page.getByText('Cần thu hôm nay')).toBeVisible();
  });

  test('điều hướng sidebar → các trang chính render', async ({ page }) => {
    await loginDemo(page);

    // exact: true — tránh khớp nhầm link khác chứa chữ tương tự (vd nút "Mở lịch phòng").
    await page.getByRole('link', { name: 'Lịch phòng', exact: true }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole('heading', { name: 'Lịch phòng' })).toBeVisible();

    await page.getByRole('link', { name: 'Hoá đơn & Thanh toán', exact: true }).click();
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(page.getByRole('heading', { name: 'Hoá đơn' })).toBeVisible();

    await page.getByRole('link', { name: 'Báo cáo', exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { name: 'Báo cáo' })).toBeVisible();

    await page.getByRole('link', { name: 'Cài đặt', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible();
  });
});
