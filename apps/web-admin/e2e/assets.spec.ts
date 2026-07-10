import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Đợt 2/2.6 — trang /assets: Tài sản & khấu hao. Seed Đợt 3 có 3 tài sản + 3–4 kỳ
 * khấu hao/tài sản cho cơ sở demo. Read-only: điều hướng + đọc + MỞ dialog (không mutate).
 */
test('mở trang Tài sản, bảng render + có dữ liệu seed', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Tài sản', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tài sản' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Nguyên giá' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('mở lịch khấu hao của tài sản đầu tiên', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Tài sản', exact: true }).click();
  await page.getByRole('button', { name: 'Khấu hao' }).first().click();
  await expect(page.getByRole('heading', { name: /Lịch khấu hao/ })).toBeVisible();
});

test('dialog "Thêm tài sản" mở với các trường chính', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Tài sản', exact: true }).click();
  await page.getByRole('button', { name: 'Thêm tài sản' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Thêm tài sản' })).toBeVisible();
  // exact: true — nhãn trùng cụm từ trong DialogDescription (getByText mặc định khớp substring).
  await expect(dialog.getByText('Tên tài sản', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Nguyên giá (₫)', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Số tháng khấu hao', { exact: true })).toBeVisible();
});
