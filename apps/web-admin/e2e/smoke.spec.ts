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

    await page.getByRole('link', { name: 'Hoá đơn', exact: true }).click();
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(page.getByRole('heading', { name: 'Hoá đơn' })).toBeVisible();

    await page.getByRole('link', { name: 'Thanh toán', exact: true }).click();
    await expect(page).toHaveURL(/\/payments$/);
    await expect(page.getByRole('heading', { name: 'Sổ thanh toán' })).toBeVisible();

    await page.getByRole('link', { name: 'Báo cáo', exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { name: 'Báo cáo' })).toBeVisible();

    await page.getByRole('link', { name: 'Cài đặt', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible();
  });

  test('lịch: chuyển chế độ Giờ → lưới 24 cột giờ + quay lại Ngày (A3 HOURLY)', async ({ page }) => {
    await loginDemo(page);
    await page.getByRole('link', { name: 'Lịch phòng', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Lịch phòng' })).toBeVisible();

    // Mặc định chế độ Ngày.
    await expect(page.getByRole('button', { name: 'Ngày', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Chuyển sang Giờ → header giờ 00:00..23:00 hiện.
    await page.getByRole('button', { name: 'Giờ' }).click();
    await expect(page.getByRole('button', { name: 'Giờ' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('00:00', { exact: true })).toBeVisible();
    await expect(page.getByText('23:00', { exact: true })).toBeVisible();

    // Quay lại Ngày.
    await page.getByRole('button', { name: 'Ngày', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ngày', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('báo cáo → nút Excel tải file .xlsx (A3 F3 phần 2)', async ({ page }) => {
    await loginDemo(page);
    await page.getByRole('link', { name: 'Báo cáo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Báo cáo' })).toBeVisible();

    // Nút export hiển thị; bấm Excel → tải file đặt tên theo kỳ.
    await expect(page.getByRole('button', { name: 'PDF' })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Excel' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^bao-cao-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
