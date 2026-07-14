import { type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Đợt 2/2.7 (docs/19 §3) — chi tiết booking: Card 'Phụ thu' + Card 'Điện/nước'.
 * Seed (pnpm db:seed:dev, tenant demo): booking CHECKED_IN 'Đặng Văn Nam' (phòng 102, DAILY)
 * có 3 phụ thu seed — gồm 'Phụ thu thêm 1 khách người lớn' 150.000₫ — và vì DAILY nên KHÔNG
 * có Card 'Điện/nước'. Booking MONTHLY 'Phòng 401 — Thuê tháng' (CHECKED_IN) có Card 'Điện/nước'
 * 2 kỳ: kỳ trước tiêu thụ điện 125,5 kWh & nước 5,5 m³; kỳ hiện tại end=NULL → '—'.
 *
 * ⚠️ ĐIỀU HƯỚNG CLIENT-SIDE (lọc status + click dòng theo text, KHÔNG page.goto): phiên
 * access-token + cơ sở đang chọn giữ IN-MEMORY (Zustand) — page.goto = hard reload → mất
 * phiên → đá về /login (như booking-detail.spec.ts / discounts.spec.ts).
 * KHÔNG xoá 3 phụ thu seed (demo check-out fold 3 dòng đó vào STAY invoice — fixture Đợt 3).
 */

/** Lọc list theo status → click dòng chứa text → vào chi tiết (mirror booking-detail.spec.ts). */
async function openBookingByText(page: Page, status: string, rowText: string): Promise<void> {
  await page.getByRole('link', { name: 'Đặt phòng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đặt phòng' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Trạng thái' }).click();
  await page.getByRole('option', { name: status, exact: true }).click();
  const row = page.locator('tbody tr', { hasText: rowText });
  await expect(row.first()).toBeVisible();
  await row.first().click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
}

test("phụ thu 'Đặng Văn Nam': seed + thêm/xoá dòng test; KHÔNG có Card Điện/nước", async ({
  page,
}) => {
  await loginDemo(page);
  await openBookingByText(page, 'CHECKED_IN', 'Đặng Văn Nam');

  // Scope vào <main> — sidebar có link trùng nhãn card.
  const main = page.getByRole('main');

  // Card 'Phụ thu' + form thêm (booking CHECKED_IN, không terminal) hiện.
  await expect(main.getByLabel('Nhãn')).toBeVisible();
  await expect(main.getByLabel('Số tiền (₫)')).toBeVisible();

  // Neo 1 trong 3 dòng seed: 'Phụ thu thêm 1 khách người lớn' = 150.000₫ (vnd()).
  const seedRow = main.locator('li', { hasText: 'Phụ thu thêm 1 khách người lớn' });
  await expect(seedRow).toContainText('150.000');

  // DAILY → KHÔNG render Card 'Điện/nước' (nhãn có dấu '/' — KHÁC badge 'Điện nước' của UTILITY).
  await expect(main.getByText('Điện/nước')).toHaveCount(0);

  // Thêm 1 dòng test (nhãn + số tiền RIÊNG, tách khỏi seed) → dòng mới xuất hiện với amount đã nhập.
  const label = 'Phụ thu test e2e';
  await main.getByLabel('Nhãn').fill(label);
  await main.getByLabel('Số tiền (₫)').fill('12345');
  await main.getByRole('button', { name: 'Thêm', exact: true }).click();

  const testRow = main.locator('li', { hasText: label });
  await expect(testRow).toBeVisible();
  await expect(testRow).toContainText('12.345'); // vnd(12345)

  // Xoá ĐÚNG dòng test (nút xoá có aria-label riêng) → biến mất; seed KHÔNG bị đụng.
  await main.getByRole('button', { name: `Xoá ${label}` }).click();
  await expect(main.locator('li', { hasText: label })).toHaveCount(0);
  await expect(main.locator('li', { hasText: 'Phụ thu thêm 1 khách người lớn' })).toBeVisible();
});

test("booking MONTHLY 'Thuê tháng': Card Điện/nước + số tiêu thụ", async ({ page }) => {
  await loginDemo(page);
  await openBookingByText(page, 'CHECKED_IN', 'Thuê tháng');

  const main = page.getByRole('main');

  // Card 'Điện/nước' hiện cho booking MONTHLY.
  await expect(main.getByText('Điện/nước')).toBeVisible();

  // Tiêu thụ kỳ TRƯỚC = end−start (vi-VN, dấu phẩy). exact → khớp ĐÚNG ô tiêu thụ
  // (tránh trùng '5,5' lọt trong '1.375,5' của cột chỉ số điện): điện 125,5 kWh & nước 5,5 m³.
  await expect(main.getByText('125,5', { exact: true })).toBeVisible();
  await expect(main.getByText('5,5', { exact: true })).toBeVisible();
});
