import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Đợt 2/2.2 — Mã giảm giá (docs/19 §3). Cần API :3001 + `pnpm db:seed:dev` (tenant demo).
 * Seed 3 voucher: SUMMER10 (PERCENT 1000bp=10%, mọi cơ sở), GIAM50K (FIXED 50.000₫, 1 cơ sở),
 * HETHAN (PERCENT 2000bp=20%, HẾT HẠN). Đăng nhập demo = OWNER (thấy mục + quản lý được).
 */

test('trang /discounts: bảng seed + ĐƠN VỊ bp→% đúng + mở dialog (read-only)', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Mã giảm giá', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mã giảm giá' })).toBeVisible();

  // ⚠️ Neo đơn vị basis-point → %: SUMMER10=1000bp phải hiện '10%', HETHAN=2000bp '20%'.
  const summer = page.locator('tbody tr', { hasText: 'SUMMER10' });
  await expect(summer).toContainText('10%');
  await expect(summer).toContainText('Mọi cơ sở');

  const hethan = page.locator('tbody tr', { hasText: 'HETHAN' });
  await expect(hethan).toContainText('20%');

  // FIXED hiện tiền VND (vnd() → '50.000₫'); phạm vi 1 phần tử → '1 cơ sở'.
  const giam = page.locator('tbody tr', { hasText: 'GIAM50K' });
  await expect(giam).toContainText('50.000');
  await expect(giam).toContainText('1 cơ sở');

  // Dialog "Thêm mã": các trường chính hiện → ĐÓNG (không submit, không mutate seed).
  await page.getByRole('button', { name: 'Thêm mã' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Thêm mã giảm giá' })).toBeVisible();
  await expect(dialog.getByText('Mã giảm giá', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Loại', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Giá trị (%)', { exact: true })).toBeVisible(); // PERCENT mặc định
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeHidden();
});

test('áp mã ở /bookings/new: HETHAN → đỏ + nút disabled; SUMMER10 → xanh + dòng Giảm giá', async ({
  page,
}) => {
  await loginDemo(page);

  // ⚠️ ĐIỀU HƯỚNG CLIENT-SIDE (KHÔNG page.goto). /bookings/new cần access-token + cơ sở đang
  // chọn — cả hai giữ IN-MEMORY (Zustand, docs/13 §3, KHÔNG localStorage). page.goto = hard reload
  // → mất phiên → AuthGate.bootstrapSession() refresh KHÔNG kèm CSRF (đã mất) → 403 → đá về /login.
  // Vào /bookings/new bằng router.push qua nút "Đặt phòng" của toolbar lịch (giữ phiên) như mọi spec.
  await page.getByRole('link', { name: 'Lịch phòng', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'Đặt phòng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đặt phòng mới' })).toBeVisible();

  // Chọn resource đầu tiên (trigger có id=resource_id).
  await page.locator('#resource_id').click();
  await page.getByRole('option').first().click();

  // Chọn ngày qua DateTimePicker (rdp v9): mở popover → "next-month" 1 lần → click ô data-day.
  // Ngày 15→17 tháng SAU: chắc chắn tương lai, KHÔNG phụ thuộc phòng trống (/pricing/quote chỉ tính
  // giá, không kiểm availability). defaultHour tự set giờ (14 nhận / 12 trả) khi ô chưa có giá trị.
  const isoDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ci = new Date();
  ci.setMonth(ci.getMonth() + 1, 15);
  const co = new Date(ci);
  co.setDate(17);
  const pickDay = async (triggerId: string, d: Date) => {
    await page.locator(`#${triggerId}`).click();
    await page.getByRole('button', { name: 'Go to the Next Month' }).click();
    await page.locator(`[data-day="${isoDay(d)}"] button`).click();
  };
  await pickDay('check_in', ci);
  await pickDay('check_out', co);

  // Báo giá cơ sở (chưa mã) hiển thị.
  await expect(page.getByText('Cọc cần thu')).toBeVisible({ timeout: 15_000 });

  const codeInput = page.getByLabel('Mã giảm giá (tuỳ chọn)');

  // HETHAN hết hạn → 422 DISCOUNT_NOT_APPLICABLE (detail EXPIRED) → thông điệp đỏ + nút disabled.
  await codeInput.fill('HETHAN');
  await expect(page.getByText(/hết hạn/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /^Tạo & / })).toBeDisabled();

  // SUMMER10 hợp lệ → xác nhận xanh + dòng tổng "Giảm giá" trong báo giá.
  await codeInput.fill('SUMMER10');
  await expect(page.getByText('Đã áp mã SUMMER10')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Giảm giá', { exact: true })).toBeVisible();
});
