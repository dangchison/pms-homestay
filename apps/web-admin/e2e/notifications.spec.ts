import { type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Task 2.1 (docs/19 §3 Đợt 2) — chuông thông báo TopBar (inbox IN_APP).
 *
 * 1) Smoke (dữ liệu thật): seed dev KHÔNG có dòng notifications → empty-state phải
 *    render sạch; mở popover không crash / không console error.
 * 2) Deterministic (page.route stub — KHÔNG phụ thuộc seed/worker): 1 chưa đọc + 1 đã
 *    đọc → badge "1", 2 dòng render; click dòng chưa đọc → POST /notifications/<id>/read
 *    + invalidate refetch (stub trả đã đọc) → badge biến mất.
 * Logic list/mark-read/unreadCount còn được phủ ở vitest use-notifications.test.ts.
 */

const UNREAD_ID = '11111111-1111-1111-1111-111111111111';
const READ_ID = '22222222-2222-2222-2222-222222222222';

// Console error benign khi chạy demo stack (favicon/manifest/devtools/sentry/resource).
const IGNORE = [/favicon/i, /manifest/i, /react devtools/i, /sentry/i, /Failed to load resource/i, /ERR_ABORTED/i];

async function openBell(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Thông báo' }).click();
}

test('mở chuông: header + empty-state (seed rỗng), không crash / console error', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await loginDemo(page);
  await openBell(page);

  // Popover mở: tiêu đề (text của <p>, KHÁC aria-label nút — nút chỉ có icon).
  await expect(page.getByText('Thông báo', { exact: true })).toBeVisible();
  // Seed dev rỗng → empty-state; vẫn tolerate nếu tương lai có dòng (một trong hai).
  const empty = page.getByText('Chưa có thông báo', { exact: true });
  const firstRow = page.getByRole('listitem').first();
  await expect(empty.or(firstRow)).toBeVisible();

  expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
});

test('stub 1 chưa đọc + 1 đã đọc: badge "1", 2 dòng, click → POST read + badge tắt', async ({ page }) => {
  let marked = false;
  // 1 handler cho cả GET list lẫn POST read (thứ tự khớp bất kể glob).
  await page.route('**/api/v1/notifications**', async (route) => {
    if (route.request().method() === 'POST') {
      marked = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
      return;
    }
    const now = Date.now();
    const rows = [
      {
        id: UNREAD_ID,
        channel: 'IN_APP',
        title: 'Đặt phòng mới',
        body: 'Phòng 101 vừa được đặt',
        metadata: {},
        is_read: marked, // sau khi POST read → refetch trả đã đọc → unread=0
        read_at: marked ? new Date(now).toISOString() : null,
        created_at: new Date(now - 5 * 60_000).toISOString(),
      },
      {
        id: READ_ID,
        channel: 'IN_APP',
        title: 'Thanh toán đã nhận',
        body: 'Đã nhận 500.000đ',
        metadata: {},
        is_read: true,
        read_at: new Date(now).toISOString(),
        created_at: new Date(now - 60 * 60_000).toISOString(),
      },
    ];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: rows }) });
  });

  await loginDemo(page);

  // Query mount đi qua stub → 1 chưa đọc → badge "1".
  const badge = page.getByTestId('notification-unread-count');
  await expect(badge).toHaveText('1');

  await openBell(page);
  await expect(page.getByText('Đặt phòng mới', { exact: true })).toBeVisible();
  await expect(page.getByText('Thanh toán đã nhận', { exact: true })).toBeVisible();

  // Click dòng chưa đọc → POST /notifications/<id>/read.
  const readReq = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes(`/notifications/${UNREAD_ID}/read`),
  );
  await page.getByText('Đặt phòng mới', { exact: true }).click();
  await readReq;

  // invalidate ['notifications'] → refetch (marked=true) → unread=0 → badge biến mất.
  await expect(badge).toHaveCount(0);
});
