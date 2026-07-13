import { type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Đợt 2/2.8 (docs/19 §3) — Compliance UI: khai báo tạm trú khách nước ngoài (NA17) +
 * nút gửi B6 (TT56). Cần API :3001 (đã REBUILD — route mới) + `pnpm db:seed:dev`
 * (tenant demo). Đăng nhập demo = OWNER (có `guest.pii.read` + thấy tab 'Tuân thủ').
 *
 * Seed (scripts/seed-dev.ts, cơ sở mặc định của demo mang khai báo):
 *  - Michael Anderson: SUBMITTED, visa DL last4 '0421' (mask), mã tiếp nhận 'XNC-DEMO-001'.
 *  - Kim Ji-woo: DRAFT, visa 'EXEMPT' (miễn thị thực), số thị thực NULL.
 *
 * ⚠️ ĐIỀU HƯỚNG CLIENT-SIDE (KHÔNG page.goto): phiên access-token + cơ sở đang chọn giữ
 * IN-MEMORY (Zustand) — page.goto = hard reload → mất phiên → đá về /login. Vào Settings
 * qua link sidebar, sang trang con qua link 'Khai báo tạm trú...' (router push).
 *
 * ⚠️ RE-RUNNABLE: chỉ đọc (list/mask/khoá-sửa) + tải NA17 (audit append) — KHÔNG bấm
 * 'Gửi XNC' (mutate Kim DRAFT→SUBMITTED, vỡ lần chạy 2) và KHÔNG submit dialog tạo mới
 * (2 khách NN đã có khai báo → 409, không có endpoint DELETE tự dọn). 'Gửi B6' idempotent
 * (chạy lại → skipped); assertion KHOAN DUNG với số đếm (chỉ khẳng định có tóm tắt).
 */

const SUBPAGE_LINK = 'Khai báo tạm trú khách nước ngoài (NA17)';

async function openCompliance(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Cài đặt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible();
  await page.getByRole('link', { name: 'Tuân thủ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Báo cáo lưu trú (TT56)' })).toBeVisible();
}

async function openSubPage(page: Page): Promise<void> {
  await openCompliance(page);
  await page.getByRole('link', { name: SUBPAGE_LINK }).click();
  await expect(page).toHaveURL(/\/settings\/compliance\/foreign-residence$/);
  await expect(page.getByRole('heading', { name: /Khai báo tạm trú khách nước ngoài/ })).toBeVisible();
}

test('trang con NA17: bảng 2 khai báo seed + mask last4 + khoá sửa SUBMITTED + tải NA17', async ({
  page,
}) => {
  await loginDemo(page);
  await openSubPage(page);

  // Michael Anderson — SUBMITTED: visa mask CHỈ 4 số cuối '0421', mã 'XNC-DEMO-001',
  // trạng thái 'Đã gửi', nút 'Sửa' KHÔNG bật (khoá sau SUBMITTED).
  const anderson = page.locator('tbody tr', { hasText: 'Michael Anderson' });
  await expect(anderson).toBeVisible();
  await expect(anderson).toContainText('0421');
  await expect(anderson).toContainText('XNC-DEMO-001');
  await expect(anderson).toContainText('Đã gửi');
  await expect(anderson.getByRole('button', { name: 'Sửa' })).toBeDisabled();

  // Kim Ji-woo — DRAFT: 'Miễn thị thực' (EXEMPT), có 'Sửa' + 'Gửi XNC' BẬT (KHÔNG bấm).
  const kim = page.locator('tbody tr', { hasText: 'Kim Ji-woo' });
  await expect(kim).toBeVisible();
  await expect(kim).toContainText('Miễn thị thực');
  await expect(kim).toContainText('Nháp');
  await expect(kim.getByRole('button', { name: 'Sửa' })).toBeEnabled();
  await expect(kim.getByRole('button', { name: 'Gửi XNC' })).toBeEnabled();

  // Tải NA17 (Anderson) → getBlob (Bearer) → downloadBlob kích hoạt tải; bắt sự kiện
  // download tên khớp na17-*.xlsx (KHÔNG dùng <a href> trực tiếp).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    anderson.getByRole('button', { name: 'Tải NA17' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^na17-.*\.xlsx$/);
});

test("trang con NA17: mở dialog 'Thêm khai báo' kiểm các trường rồi Hủy (KHÔNG submit)", async ({
  page,
}) => {
  await loginDemo(page);
  await openSubPage(page);

  await page.getByRole('button', { name: 'Thêm khai báo' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Thêm khai báo tạm trú' })).toBeVisible();

  // Bộ chọn booking + các trường NA17 hiện.
  await expect(dialog.getByText('Đặt phòng', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Loại thị thực', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Số thị thực', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Ngày nhập cảnh', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Cửa khẩu nhập cảnh', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Ngày dự kiến rời đi', { exact: true })).toBeVisible();

  // Hủy — KHÔNG submit (không mutate seed).
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeHidden();
});

test("nút 'Gửi B6' trên /settings/compliance: no-range validate + có-range tóm tắt", async ({
  page,
}) => {
  await loginDemo(page);
  await openCompliance(page);

  // CHƯA chọn khoảng ngày → toast.error xác định (KHÔNG gọi BE).
  await page.getByRole('button', { name: 'Gửi B6' }).click();
  await expect(page.getByText('Chọn khoảng thời gian')).toBeVisible();

  // Chọn khoảng ngày trong THÁNG hiện tại (DateRangePicker hiện 2 tháng, không cần next).
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 5);
  const to = new Date(now.getFullYear(), now.getMonth(), 25);

  await page.getByRole('button', { name: 'Chọn khoảng ngày' }).click();
  await page.locator(`[data-day="${iso(from)}"] button`).first().click();
  await page.locator(`[data-day="${iso(to)}"] button`).first().click();
  await page.keyboard.press('Escape'); // range mode KHÔNG tự đóng popover

  // Có khoảng ngày → POST /compliance/police-report/submit → toast tóm tắt {total,...}.
  // KHOAN DUNG: chỉ khẳng định có dòng tóm tắt (số đếm phụ thuộc seed/lần chạy — idempotent).
  await page.getByRole('button', { name: 'Gửi B6' }).click();
  await expect(page.getByText(/Gửi B6: tổng/)).toBeVisible({ timeout: 15_000 });
});
