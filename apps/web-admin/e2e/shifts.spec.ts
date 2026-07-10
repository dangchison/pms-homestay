import { type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Task 2.3 (docs/19 §3 Đợt 2) — trang /shifts: Sổ quỹ ca.
 * Dữ liệu demo (pnpm db:seed:dev) cho cơ sở "Cơ sở Demo — Mỹ Khê": ĐÚNG 3 ca —
 *   - Ca A CLOSED: đếm 2.380.000 vs kỳ vọng 2.530.000 → chênh lệch −150.000₫ (đỏ);
 *     2 payment CASH trong ca: 1.400.000₫ + 630.000₫.
 *   - Ca B CLOSED: khớp quỹ → chênh lệch 0₫.
 *   - Ca C OPEN  : ca đang mở duy nhất (partial unique 1 ca OPEN/cơ sở).
 * Demo = OWNER (payment.reconcile) → nút "Mở ca" hiện nhưng DISABLED vì đã có Ca C OPEN.
 *
 * Chỉ ĐỌC — KHÔNG mở/đóng ca (đóng Ca C sẽ phá tính idempotent của lần chạy sau: one-open
 * -per-property ⇒ lần 2 không còn ca OPEN). Kiểm thử wiring mutation nằm ở use-shifts.test.ts.
 * Chờ theo role/label/text (KHÔNG networkidle).
 */
async function openShiftsPage(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Sổ quỹ ca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sổ quỹ ca' })).toBeVisible();
}

test('hiện đúng 3 ca + chênh lệch âm (đỏ) + badge trạng thái', async ({ page }) => {
  await loginDemo(page);
  await openShiftsPage(page);

  // Bảng có ĐÚNG 3 dòng ca (2 CLOSED + 1 OPEN từ seed).
  await expect(page.locator('tbody tr')).toHaveCount(3);

  // Chênh lệch −150.000₫ hiển thị và mang class text-destructive (đỏ, vì âm).
  const variance = page.getByText('-150.000₫', { exact: true });
  await expect(variance).toBeVisible();
  await expect(variance).toHaveClass(/text-destructive/);

  // Badge trạng thái: có ca đang mở + ca đã đóng.
  await expect(page.getByText('Đang mở', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Đã đóng', { exact: true }).first()).toBeVisible();
});

test('nút "Mở ca" hiển thị (OWNER) nhưng disabled vì đã có ca OPEN', async ({ page }) => {
  await loginDemo(page);
  await openShiftsPage(page);

  const openBtn = page.getByRole('button', { name: 'Mở ca' });
  await expect(openBtn).toBeVisible();
  await expect(openBtn).toBeDisabled();
});

test('click dòng ca CLOSED −150k mở chi tiết + liệt kê payment CASH', async ({ page }) => {
  await loginDemo(page);
  await openShiftsPage(page);

  // Mở chi tiết bằng cách click dòng ca có chênh lệch −150.000₫ (Ca A).
  await page.getByRole('row').filter({ hasText: '-150.000₫' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Chi tiết ca' })).toBeVisible();
  // 2 payment CASH trong cửa sổ ca A.
  await expect(dialog.getByText('1.400.000₫', { exact: true })).toBeVisible();
  await expect(dialog.getByText('630.000₫', { exact: true })).toBeVisible();
});
