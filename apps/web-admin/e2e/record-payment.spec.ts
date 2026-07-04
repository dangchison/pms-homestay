import { test, expect } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Flow ghi (docs/18 P2-A1): mở 1 hoá đơn còn nợ → "Thu tiền" (mặc định = số còn lại)
 * → "Ghi nhận" → còn lại về 0₫. Dữ liệu demo có hoá đơn quá hạn (INV-…0004/0005).
 * Idempotent ở CI (seed mới mỗi lần); local chạy lại vẫn ok vì luôn tìm hoá đơn còn nợ.
 */
test('thu tiền một hoá đơn còn nợ → còn lại về 0₫', async ({ page }) => {
  await loginDemo(page);

  await page.getByRole('link', { name: 'Hoá đơn', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hoá đơn' })).toBeVisible();

  // Tìm dòng vừa CÒN NỢ (cột "Còn lại" ≠ 0₫) vừa THU ĐƯỢC (trạng thái payable). Chỉ
  // xét "còn nợ" là chưa đủ: dữ liệu demo có hoá đơn REFUNDED (đã hoàn tiền → balance
  // khôi phục ≠ 0) đứng đầu danh sách nhưng KHÔNG có nút "Thu tiền" → phải bỏ qua.
  // Nhãn badge trạng thái xem components/invoices/badges.tsx.
  const PAYABLE_LABELS = ['Đã phát hành', 'Trả một phần', 'Quá hạn'];
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  let target = -1;
  for (let i = 0; i < count; i++) {
    const status = (await rows.nth(i).locator('td').nth(2).innerText()).trim();
    const balance = (await rows.nth(i).locator('td').last().innerText()).trim();
    if (PAYABLE_LABELS.includes(status) && balance !== '0₫') {
      target = i;
      break;
    }
  }
  expect(target, 'cần ít nhất 1 hoá đơn còn nợ & thu được trong dữ liệu demo').toBeGreaterThanOrEqual(0);

  await rows.nth(target).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);

  // Mở dialog thu tiền (số tiền mặc định = số còn lại) → ghi nhận.
  await page.getByRole('button', { name: 'Thu tiền' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Ghi nhận' }).click();

  // Xác nhận: toast thành công + còn lại về 0₫ (SSE/invalidate cập nhật detail).
  await expect(page.getByText('Đã ghi nhận thanh toán')).toBeVisible();
  await expect(page.getByText('Còn lại').locator('xpath=following-sibling::*[1]')).toHaveText('0₫');
});
