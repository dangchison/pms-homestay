import { type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Task 1.3 (docs/19 §2 Đợt 1) — trang /properties: 3 tab Phòng / Bookable unit / Block bảo trì.
 * Dữ liệu demo (pnpm db:seed:dev): cơ sở "Homestay Demo" + 8 phòng (101–302) + 1 nguyên căn.
 *
 * Không xoá phòng/nguyên căn seed (DELETE trả 409 nếu còn room_occupancy) — chỉ TẠO mới:
 *   test 1 tạo phòng room_number duy nhất; test 2 tạo block cho phòng đầu danh sách.
 * Chờ theo role/label/text, KHÔNG networkidle (SSE giữ kết nối mở).
 */

/** Mở /properties qua sidebar; PropertySwitcher tự chọn cơ sở đầu khi nạp. */
async function openProperties(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Cơ sở & Phòng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cơ sở & Phòng' })).toBeVisible();
  // Tab Phòng là mặc định → nút "Thêm phòng" chỉ hiện khi đã có propertyId (guard đã qua).
  await expect(page.getByRole('button', { name: 'Thêm phòng' })).toBeVisible();
}

test('tab Phòng — thêm phòng mới xuất hiện trong bảng', async ({ page }) => {
  await loginDemo(page);
  await openProperties(page);

  const roomNumber = `E2E-${Date.now()}`;

  await page.getByRole('button', { name: 'Thêm phòng' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Thêm phòng' })).toBeVisible();

  await dialog.getByLabel('Số phòng').fill(roomNumber);
  await dialog.getByRole('button', { name: 'Thêm phòng' }).click();

  // Dialog đóng + phòng mới xuất hiện trong bảng (invalidate ['rooms'] → refetch).
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: roomNumber, exact: true })).toBeVisible();
});

test('tab Block bảo trì — chọn phòng rồi thêm block mới', async ({ page }) => {
  await loginDemo(page);
  await openProperties(page);

  // Chuyển sang tab Block bảo trì.
  await page.getByRole('tab', { name: 'Block bảo trì', exact: true }).click();

  // Chọn phòng đầu tiên trong Select (option portal ra document.body — không scope trong main).
  await page.getByRole('combobox', { name: 'Chọn phòng' }).click();
  await page.getByRole('option').first().click();

  // Mở dialog thêm block.
  await page.getByRole('button', { name: 'Thêm block' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Thêm block bảo trì' })).toBeVisible();

  // datetime-local nhận chuỗi 'YYYY-MM-DDTHH:mm'; end_at > start_at (schema refine).
  // Khoảng phải DUY NHẤT mỗi lần chạy: API chặn block chồng lấn cùng phòng (409 BOOKING_OVERLAP,
  // room-blocks.service.findOverlaps dùng period && tstzrange(from,to,'[)')) → chạy lại với
  // khoảng cố định sẽ đụng block cũ, mutateAsync reject, dialog KHÔNG đóng. Lấy 1 "slot" 60 phút
  // riêng-mỗi-lần từ Date.now(): các slot kề nhau cách đúng 60 phút nên chỉ chạm mép ([) → không
  // chồng), lại nằm ở tương lai xa (2099+) nên không bao giờ đụng seed. (giống test 1 dùng Date.now().)
  const SLOT_MIN = 60;
  const slotIdx = Date.now() % (30 * 24 * 60); // ~43200 slot phân biệt giữa các lần chạy gần nhau
  const runStart = new Date(Date.UTC(2099, 0, 1) + slotIdx * SLOT_MIN * 60_000);
  const runEnd = new Date(runStart.getTime() + SLOT_MIN * 60_000);
  const toLocalInput = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await dialog.getByLabel('Từ').fill(toLocalInput(runStart));
  await dialog.getByLabel('Đến').fill(toLocalInput(runEnd));
  const reason = `Bảo trì e2e ${Date.now()}`;
  await dialog.getByLabel('Lý do').fill(reason);
  await dialog.getByRole('button', { name: 'Thêm block' }).click();

  // Dialog đóng + block mới hiện trong danh sách phòng đang chọn.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: reason, exact: true })).toBeVisible();
});
