import { test, expect } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Task 1.1 (docs/19 §2 Đợt 1) — trang /bookings: danh sách booking theo cơ sở + filter.
 * Dữ liệu demo (pnpm db:seed:dev) có ≥17 booking, ≥6 CHECKED_IN, nguồn OTA iCal.
 *
 * Flow: đăng nhập demo → mở "Đặt phòng" → thấy bảng >0 dòng (cột Mã/Phòng/Khách/Ngày/
 * Trạng thái/Nguồn/Tổng) → chọn trạng thái CHECKED_IN trong Select → danh sách thu hẹp,
 * MỌI badge trạng thái hiển thị nhãn "Đang ở" (nhãn CHECKED_IN của BookingStatusBadge).
 */
test('lọc trạng thái CHECKED_IN → mọi dòng hiển thị badge "Đang ở"', async ({ page }) => {
  await loginDemo(page);

  await page.getByRole('link', { name: 'Đặt phòng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đặt phòng' })).toBeVisible();

  // Bảng có dữ liệu (seed demo ≥17 booking).
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const totalBefore = await rows.count();
  expect(totalBefore).toBeGreaterThan(0);
  // Cột tiêu đề đúng thứ tự spec.
  await expect(page.getByRole('columnheader', { name: 'Mã' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Trạng thái' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Nguồn' })).toBeVisible();

  // Mở Select "Trạng thái" (Radix combobox) → chọn CHECKED_IN.
  await page.getByRole('combobox', { name: 'Trạng thái' }).click();
  await page.getByRole('option', { name: 'CHECKED_IN', exact: true }).click();

  // Chờ danh sách cập nhật: mọi dòng hiển thị badge "Đang ở" (nhãn CHECKED_IN).
  // BookingStatusBadge (packages/ui) map CHECKED_IN → "Đang ở".
  await expect(rows.first()).toBeVisible();
  const filtered = await rows.count();
  expect(filtered).toBeGreaterThan(0);

  // Mọi dòng: cột "Trạng thái" (index 4) hiển thị badge "Đang ở" (nhãn CHECKED_IN).
  for (let i = 0; i < filtered; i++) {
    await expect(rows.nth(i).locator('td').nth(4)).toContainText('Đang ở');
  }
  // Không còn nhãn trạng thái khác trong bảng (list thu hẹp đúng).
  const OTHER_LABELS = ['Giữ chỗ', 'Chờ cọc', 'Đã xác nhận', 'Đã trả phòng', 'Đã hủy', 'No-show'];
  const tbody = page.locator('tbody');
  for (const label of OTHER_LABELS) {
    await expect(tbody.getByText(label, { exact: true })).toHaveCount(0);
  }
});

/** Click 1 dòng → điều hướng tới /bookings/<id> (con trỏ pointer, hover:bg-accent). */
test('click 1 dòng → điều hướng tới trang chi tiết /bookings/<id>', async ({ page }) => {
  await loginDemo(page);

  await page.getByRole('link', { name: 'Đặt phòng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đặt phòng' })).toBeVisible();

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
});
