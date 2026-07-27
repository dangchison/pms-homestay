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

/**
 * Tab "Gói giá" — vòng tạo → đọc lại → sửa → xoá.
 *
 * Trọng tâm: ĐƠN VỊ CỌC. DB lưu basis point (3000 = 30%) nhưng người dùng nhập/đọc
 * theo phần trăm. Sai chiều quy đổi thì cọc lệch 100 lần mà typecheck không bắt được,
 * nên test khẳng định cả hai chiều: bảng hiện "30%" và form sửa nạp lại đúng "30".
 *
 * Tự dọn (xoá gói vừa tạo) để chạy lại nhiều lần không tích rác — khác các test trên
 * vì gói giá KHÔNG bị chặn xoá bởi room_occupancy.
 */
test('tab Gói giá — tạo gói có cọc 30%, đọc lại đúng đơn vị, rồi xoá', async ({ page }) => {
  await loginDemo(page);
  await openProperties(page);

  const planName = `Gói E2E ${Date.now()}`;
  await page.getByRole('tab', { name: 'Gói giá', exact: true }).click();
  await page.getByRole('button', { name: 'Tạo gói giá' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Tạo gói giá' })).toBeVisible();
  await dialog.getByLabel('Tên gói').fill(planName);
  await dialog.getByLabel(/^Giá cơ bản/).fill('700000');

  // Chọn cọc theo phần trăm rồi nhập 30 (KHÔNG phải 3000).
  await dialog.getByRole('combobox', { name: 'Chính sách cọc' }).click();
  await page.getByRole('option', { name: 'Theo phần trăm' }).click();
  await dialog.getByLabel('Mức cọc (%)').fill('30');

  await dialog.getByRole('button', { name: 'Tạo gói giá' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Chiều 1 — bảng phải hiện "30%", không phải "3000%" hay "0.3%".
  const row = page.getByRole('row', { name: new RegExp(planName) });
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell', { name: '30%', exact: true })).toBeVisible();

  // Chiều 2 — form sửa nạp lại phải là 30.
  await row.getByRole('button', { name: 'Sửa', exact: true }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog.getByLabel('Mức cọc (%)')).toHaveValue('30');
  // Phương thức thuê khoá khi sửa (UpdateRatePlanRequestSchema không nhận `mode`).
  await expect(editDialog.getByRole('combobox', { name: 'Phương thức thuê' })).toBeDisabled();
  await editDialog.getByRole('button', { name: 'Hủy' }).click();

  // Dọn.
  await row.getByRole('button', { name: 'Xoá', exact: true }).click();
  await expect(page.getByRole('row', { name: new RegExp(planName) })).toHaveCount(0);
});

/**
 * Dialog "Thêm cơ sở" — KHÔNG tạo thật (gói PRO giới hạn 5 cơ sở, chạy lại nhiều lần
 * sẽ chạm trần và làm bẩn dữ liệu demo). Chỉ khẳng định hai điều dễ hỏng:
 *   1) tỉnh/thành bắt buộc — nếu lỏng thì báo cáo lưu trú công an thiếu dữ liệu;
 *   2) nhóm chủ nhà chỉ hiện khi bật thuê lại cho thuê, và hai mô hình trả tiền
 *      loại trừ nhau (chọn chia doanh thu thì field tiền thuê cố định biến mất).
 */
test('dialog Thêm cơ sở — bắt buộc tỉnh/thành và hai mô hình trả chủ nhà loại trừ nhau', async ({
  page,
}) => {
  await loginDemo(page);
  await openProperties(page);

  await page.getByRole('button', { name: 'Thêm cơ sở' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Thêm cơ sở' })).toBeVisible();

  // Điền mọi thứ TRỪ tỉnh/thành → submit phải bị chặn tại client.
  await dialog.getByLabel('Tên cơ sở').fill('Cơ sở E2E');
  await dialog.getByLabel('Địa chỉ').fill('1 Đường Test');
  await dialog.getByRole('button', { name: 'Tạo cơ sở' }).click();
  await expect(dialog.getByText(/Bắt buộc.*báo cáo lưu trú công an/)).toBeVisible();

  // Nhóm chủ nhà ẩn cho tới khi bật thuê lại cho thuê.
  await expect(dialog.getByLabel('Tên chủ nhà')).toHaveCount(0);
  await dialog.getByText('Cơ sở này đi thuê lại rồi cho thuê').click();
  await expect(dialog.getByLabel('Tên chủ nhà')).toBeVisible();

  // Mặc định là tiền thuê cố định; đổi sang chia doanh thu thì field kia phải biến mất.
  await expect(dialog.getByLabel(/Tiền thuê hằng tháng/)).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Cách trả chủ nhà' }).click();
  await page.getByRole('option', { name: 'Chia phần trăm doanh thu' }).click();
  await expect(dialog.getByLabel(/Tiền thuê hằng tháng/)).toHaveCount(0);
  await expect(dialog.getByLabel(/Chủ nhà hưởng/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
