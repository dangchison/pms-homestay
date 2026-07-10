import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Đợt 2/2.5 — trang /expenses: Chi phí vận hành. Seed Đợt 3 có ~8 chi phí cho cơ sở
 * demo. Read-only: điều hướng + đọc bảng + MỞ dialog thêm (KHÔNG submit → không mutate).
 */
test('mở trang Chi phí, bảng render + có dữ liệu seed', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Chi phí', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chi phí' })).toBeVisible();

  // Header cột luôn hiện khi tải xong; seed có ít nhất 1 dòng chi phí.
  await expect(page.getByRole('columnheader', { name: 'Ngày chi' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('dialog "Thêm chi phí" mở với các trường chính', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Chi phí', exact: true }).click();
  await page.getByRole('button', { name: 'Thêm chi phí' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Thêm chi phí' })).toBeVisible();
  await expect(dialog.getByText('Loại chi phí')).toBeVisible();
  await expect(dialog.getByText('Số tiền (₫)')).toBeVisible();
  await expect(dialog.getByText('Chi phí định kỳ')).toBeVisible();
});
