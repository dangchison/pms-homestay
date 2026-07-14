import { type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Task 2.9 (docs/19 §3 Đợt 2) — chip tín hiệu danh tính cross-tenant trong GuestDetailDialog.
 *
 * KHÔNG phụ thuộc seed: seed dev tạo khách với PII=NULL → person_id NULL → endpoint thật
 * `GET /guests/:id/platform-summary` trả `linked:false` cho MỌI khách demo (chip không bao giờ
 * hiện với dữ liệu thật). Vì vậy phải stub endpoint này bằng `page.route` (như notifications.spec).
 *
 * Glob `**\/guests/*\/platform-summary` CHỈ nuốt đúng endpoint chip — KHÔNG chạm `GET /guests/:id`
 * (dialog dùng `useGuest`) hay `GET /guests?q=` (tìm khách): cả hai vẫn đi API thật (khách seed
 * có thật, ví dụ "Nguyễn Văn An").
 *
 * 3 case: (1) khách quen, (2) blacklist nơi khác, (3) chưa link → ẩn cả hai chip.
 */

type Summary = { linked: boolean; is_returning_guest: boolean; blacklisted_elsewhere: boolean };

/** Stub GET /guests/:id/platform-summary → trả JSON bọc { data } theo GuestPlatformSummaryResponse. */
async function stubPlatformSummary(page: Page, summary: Summary): Promise<void> {
  await page.route('**/guests/*/platform-summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: summary }),
    });
  });
}

/** Vào /guests → tìm "Nguyễn" → click dòng "Nguyễn Văn An" mở dialog; chờ response chip đã về. */
async function openGuestDialog(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Khách', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Khách', exact: true })).toBeVisible();

  await page.getByLabel('Tìm khách').fill('Nguyễn');
  const nameCell = page.getByRole('cell', { name: 'Nguyễn Văn An' });
  await expect(nameCell).toBeVisible();

  // Set chờ response TRƯỚC khi click để không bỏ lỡ request phát khi dialog mount.
  const summaryResp = page.waitForResponse((r) => r.url().includes('/platform-summary'));
  await nameCell.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Hồ sơ khách', { exact: false })).toBeVisible();
  await summaryResp;
}

test('linked + khách quen → badge "Khách quen", KHÔNG có "Blacklist nơi khác"', async ({ page }) => {
  await stubPlatformSummary(page, { linked: true, is_returning_guest: true, blacklisted_elsewhere: false });
  await loginDemo(page);
  await openGuestDialog(page);

  await expect(page.getByText('Khách quen', { exact: true })).toBeVisible();
  await expect(page.getByText('Blacklist nơi khác', { exact: true })).toHaveCount(0);
});

test('linked + blacklist nơi khác → badge đỏ "Blacklist nơi khác"', async ({ page }) => {
  await stubPlatformSummary(page, { linked: true, is_returning_guest: false, blacklisted_elsewhere: true });
  await loginDemo(page);
  await openGuestDialog(page);

  await expect(page.getByText('Blacklist nơi khác', { exact: true })).toBeVisible();
  await expect(page.getByText('Khách quen', { exact: true })).toHaveCount(0);
});

test('chưa link (linked:false) → ẩn cả "Khách quen" lẫn "Blacklist nơi khác"', async ({ page }) => {
  await stubPlatformSummary(page, { linked: false, is_returning_guest: true, blacklisted_elsewhere: true });
  await loginDemo(page);
  await openGuestDialog(page); // đã chờ response chip trả về → khẳng định ẩn là thật, không phải chưa tải

  await expect(page.getByText('Khách quen', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Blacklist nơi khác', { exact: true })).toHaveCount(0);
});
