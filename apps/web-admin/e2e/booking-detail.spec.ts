import { type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Task 1.2 (docs/19 §2 Đợt 1) — trang /bookings/[id]: chi tiết + vòng đời.
 * Dữ liệu demo (pnpm db:seed:dev, PR #65): booking CHECKED_OUT (idx0) có STAY invoice;
 * nhiều booking CONFIRMED; khách có SĐT → card khách phải che PII.
 *
 * Chọn trạng thái qua filter list (KHÔNG hardcode uuid) để test không giòn khi seed đổi.
 */

/** Mở list rồi lọc theo status → click dòng đầu → vào trang chi tiết. */
async function openFirstWithStatus(page: Page, status: string): Promise<void> {
  await page.getByRole('link', { name: 'Đặt phòng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đặt phòng' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Trạng thái' }).click();
  await page.getByRole('option', { name: status, exact: true }).click();
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
}

test('mở chi tiết từ list → header booking_code + card thông tin + card khách che PII', async ({ page }) => {
  await loginDemo(page);
  // CHECKED_OUT (idx0) chắc chắn có hoá đơn STAY trong seed.
  await openFirstWithStatus(page, 'CHECKED_OUT');

  // Scope vào <main> — sidebar nav có link 'Khách'/'Hoá đơn'/'Đặt phòng' trùng nhãn card.
  const main = page.getByRole('main');

  // Card thông tin: nhãn cố định render.
  await expect(main.getByText('Nguồn', { exact: true })).toBeVisible();
  await expect(main.getByText('Trạng thái', { exact: true }).first()).toBeVisible();
  await expect(main.getByText('Tổng tiền', { exact: true })).toBeVisible();
  await expect(main.getByText('Mode', { exact: true })).toBeVisible();

  // Card khách: SĐT hiển thị DẠNG CHE (chứa bullet '•'). Card thông tin KHÔNG có
  // bullet nên bất kỳ '•' trong main đều đến từ maskPhone/maskEmail.
  await expect(main.getByText('SĐT', { exact: true })).toBeVisible();
  await expect(main.getByText(/•/).first()).toBeVisible();

  // Card hoá đơn: booking CHECKED_OUT có ≥1 dòng link tới /invoices/.
  await expect(main.getByText('Hoá đơn', { exact: true })).toBeVisible();
  await expect(main.locator('a[href^="/invoices/"]').first()).toBeVisible();
});

test('booking CONFIRMED → hiện nút "Nhận phòng" + "Huỷ", KHÔNG hiện "Trả phòng"', async ({ page }) => {
  await loginDemo(page);
  await openFirstWithStatus(page, 'CONFIRMED');

  await expect(page.getByRole('button', { name: 'Nhận phòng' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Huỷ', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trả phòng' })).toHaveCount(0);
});

test('flow Huỷ: mở dialog → nhập lý do → xác nhận → badge đổi "Đã hủy" + hết nút lifecycle', async ({ page }) => {
  await loginDemo(page);
  await openFirstWithStatus(page, 'CONFIRMED');

  await page.getByRole('button', { name: 'Huỷ', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Lý do huỷ').fill('Khách đổi kế hoạch (e2e)');
  await dialog.getByRole('button', { name: 'Xác nhận huỷ' }).click();

  // Trạng thái đổi → BookingStatusBadge CANCELLED = "Đã hủy"; nút chuyển trạng thái biến mất.
  await expect(page.getByText('Đã hủy', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nhận phòng' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trả phòng' })).toHaveCount(0);
});
