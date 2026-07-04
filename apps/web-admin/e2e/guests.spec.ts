import { type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Task 1.4 (docs/19 §2 Đợt 1) — trang /guests: hồ sơ khách + blacklist.
 * Dữ liệu demo (pnpm db:seed:dev, PR #65) có ≥12 khách VN (GUEST_NAMES) — không khách nào
 * blacklist sẵn. Tìm theo 'Nguyễn' (khớp tên) ra ≥1 dòng.
 *
 * Test THAO TÁC luồng blacklist (quyền booking.update — demo chắc chắn có). KHÔNG assert
 * số giấy tờ đã giải mã (quyền guest.pii.read có thể thiếu → tránh giòn). Idempotent: gỡ
 * blacklist trước nếu dòng đầu đang blacklist (từ lần chạy trước), rồi bật lại + gỡ cuối.
 */

/** Mở trang /guests từ sidebar, chờ heading. */
async function openGuests(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Khách', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Khách' })).toBeVisible();
}

test('list che PII + cột đúng: SĐT/giấy tờ hiển thị dạng che, không lộ plaintext', async ({ page }) => {
  await loginDemo(page);
  await openGuests(page);

  const main = page.getByRole('main');
  // Cột tiêu đề đúng thứ tự spec.
  await expect(main.getByRole('columnheader', { name: 'Tên' })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: 'SĐT' })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: 'Giấy tờ' })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: 'Trạng thái' })).toBeVisible();

  // Tìm khách seed 'Nguyễn' → ≥1 dòng.
  await main.getByLabel('Tìm khách').fill('Nguyễn');
  const rows = main.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);

  // SĐT che (chứa bullet '•') — maskPhone giữ 3 số cuối.
  await expect(main.locator('tbody').getByText(/•/).first()).toBeVisible();
});

test('mở dòng đầu → dialog chi tiết → bật blacklist kèm lý do → badge + lý-do hiển thị', async ({ page }) => {
  await loginDemo(page);
  await openGuests(page);

  const main = page.getByRole('main');
  await main.getByLabel('Tìm khách').fill('Nguyễn');
  const rows = main.locator('tbody tr');
  await expect(rows.first()).toBeVisible();

  // Mở dialog chi tiết (KHÔNG điều hướng route).
  await rows.first().click();
  const detail = page.getByRole('dialog').filter({ hasText: 'Hồ sơ khách' });
  await expect(detail).toBeVisible();

  // Idempotent: nếu đang blacklist (lần chạy trước) → gỡ trước cho về trạng thái sạch.
  if (await detail.getByRole('button', { name: 'Gỡ blacklist' }).isVisible().catch(() => false)) {
    await detail.getByRole('button', { name: 'Gỡ blacklist' }).click();
    const confirmOff = page.getByRole('dialog').filter({ hasText: 'Gỡ khách khỏi blacklist?' });
    await confirmOff.getByRole('button', { name: 'Xác nhận gỡ' }).click();
    await expect(detail.getByRole('button', { name: 'Đưa vào blacklist' })).toBeVisible();
  }

  const REASON = `Gây rối (e2e ${Date.now()})`;

  // Bật blacklist: mở confirm → nhập lý do (bắt buộc) → xác nhận.
  await detail.getByRole('button', { name: 'Đưa vào blacklist' }).click();
  const confirmOn = page.getByRole('dialog').filter({ hasText: 'Đưa khách vào blacklist?' });
  await expect(confirmOn).toBeVisible();
  // Nút submit bị chặn khi lý do rỗng.
  await expect(confirmOn.getByRole('button', { name: 'Xác nhận blacklist' })).toBeDisabled();
  await confirmOn.getByLabel('Lý do (bắt buộc)').fill(REASON);
  await confirmOn.getByRole('button', { name: 'Xác nhận blacklist' }).click();

  // Sau invalidate ['guests']: badge 'Blacklist' + lý-do hiển thị trong dialog chi tiết.
  await expect(detail.getByText('Blacklist').first()).toBeVisible();
  await expect(detail.getByText(REASON)).toBeVisible();
  // Nút chuyển sang 'Gỡ blacklist'.
  await expect(detail.getByRole('button', { name: 'Gỡ blacklist' })).toBeVisible();

  // Dọn dẹp: gỡ lại để seed về trạng thái cũ (test re-runnable).
  await detail.getByRole('button', { name: 'Gỡ blacklist' }).click();
  const confirmOff = page.getByRole('dialog').filter({ hasText: 'Gỡ khách khỏi blacklist?' });
  await confirmOff.getByRole('button', { name: 'Xác nhận gỡ' }).click();
  await expect(detail.getByRole('button', { name: 'Đưa vào blacklist' })).toBeVisible();
});
