import { type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Task 1.6 (docs/19 §2 Đợt 1) — trang /channels: kênh OTA iCal + mapping + đồng bộ.
 * Dữ liệu demo (pnpm db:seed:dev, Đợt 3 D3d): 2 kênh cùng cơ sở "Mỹ Khê" —
 *   - "Airbnb — Cơ sở Mỹ Khê"     : is_active=true,  last_sync_status=SUCCESS → badge "Đồng bộ OK"
 *   - "Booking.com — Cơ sở Mỹ Khê": is_active=false, last_sync_status=FAILED  → badge "Lỗi"
 * Airbnb có 2 mapping (push token tự sinh) → PUSH URL công khai hiển thị + nút "Sao chép".
 *
 * Chỉ ĐỌC — không bấm toggle/regenerate/sync để test idempotent chạy lại được.
 * Chờ theo role/label/text, KHÔNG networkidle (SSE giữ kết nối mở).
 */

/** Mở /channels qua sidebar; PropertySwitcher tự chọn cơ sở đầu khi nạp. */
async function openChannels(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Kênh OTA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kênh OTA' })).toBeVisible();
}

test('hiện danh sách kênh + badge trạng thái đồng bộ', async ({ page }) => {
  await loginDemo(page);
  await openChannels(page);

  // ≥1 kênh: cả Airbnb và Booking (từ seed) hiển thị theo display_name.
  await expect(page.getByRole('heading', { name: 'Airbnb — Cơ sở Mỹ Khê' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Booking.com — Cơ sở Mỹ Khê' })).toBeVisible();

  // Badge trạng thái map từ last_sync_status: Airbnb SUCCESS → "Đồng bộ OK", Booking FAILED → "Lỗi".
  // Badge cấp-kênh nằm ở header (render TRƯỚC khối mappings/sync-jobs) → .first() lấy đúng badge kênh
  // (cùng nhãn cũng xuất hiện ở các dòng sync-job phía dưới, đó là mong đợi — chỉ verify badge kênh).
  const airbnb = page.getByRole('region', { name: 'Airbnb — Cơ sở Mỹ Khê' });
  const booking = page.getByRole('region', { name: 'Booking.com — Cơ sở Mỹ Khê' });
  await expect(airbnb.getByText('Đồng bộ OK', { exact: true }).first()).toBeVisible();
  await expect(booking.getByText('Lỗi', { exact: true }).first()).toBeVisible();
});

test('kênh Airbnb hiển thị PUSH URL công khai + nút Sao chép', async ({ page }) => {
  await loginDemo(page);
  await openChannels(page);

  const airbnb = page.getByRole('region', { name: 'Airbnb — Cơ sở Mỹ Khê' });
  await expect(airbnb.getByRole('heading', { name: 'Airbnb — Cơ sở Mỹ Khê' })).toBeVisible();

  // PUSH feed công khai chứa route /api/v1/public/sync/ical/<token> (bền với origin).
  await expect(
    airbnb.getByText('/api/v1/public/sync/ical/', { exact: false }).first(),
  ).toBeVisible();
  // Nút sao chép hiển thị (không assert nội dung clipboard — quyền headless không ổn định).
  await expect(airbnb.getByRole('button', { name: 'Sao chép' }).first()).toBeVisible();
});
