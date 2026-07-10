import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Đợt 2/2.4 — /reports thêm 2 tab: "Chủ nhà (R2R)" + "Chống thất thoát".
 * Demo: cơ sở chính (seed Đợt 3) đặt is_rent_to_rent=true → tab Chủ nhà HIỆN.
 * Read-only: chỉ điều hướng + đổi tab + đọc (không mutate).
 */
async function openReports(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('link', { name: 'Báo cáo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Báo cáo' })).toBeVisible();
}

test('tab "Chủ nhà (R2R)" hiện với cơ sở thuê-lại + render bảng kê', async ({ page }) => {
  await loginDemo(page);
  await openReports(page);

  const landlordTab = page.getByRole('button', { name: 'Chủ nhà (R2R)' });
  await expect(landlordTab).toBeVisible();
  await landlordTab.click();

  // Nhãn ổn định luôn render khi có dữ liệu (không phụ thuộc số tiền cụ thể).
  await expect(page.getByText('Chủ nhà nhận', { exact: true })).toBeVisible();
  await expect(page.getByText('Mô hình thanh toán', { exact: true })).toBeVisible();
});

test('tab "Chống thất thoát" render (findings hoặc empty-state)', async ({ page }) => {
  await loginDemo(page);
  await openReports(page);

  await page.getByRole('button', { name: 'Chống thất thoát' }).click();
  // Bền theo thời gian seed: hoặc bảng findings (disclaimer) hoặc empty-state.
  await expect(
    page.getByText(/Chỉ là DẤU HIỆU cần rà soát|Không phát hiện dấu hiệu bất thường/),
  ).toBeVisible();
});
