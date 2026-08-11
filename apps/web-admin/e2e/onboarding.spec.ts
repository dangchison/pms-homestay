import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Trải nghiệm của người VỪA ĐĂNG KÝ, và lối vào đặt phòng.
 *
 * Trước đây tenant chưa có cơ sở nào rơi vào ngõ cụt: header hiện selectbox "Chọn
 * cơ sở" mà bấm vào chỉ mở dropdown TRỐNG, dashboard hiện KPI "0" giả (query bị
 * enabled:false chứ không phải thật sự bằng 0), và mọi mục sidebar đều cụt ở câu
 * "chọn một cơ sở" — trong khi không có cơ sở nào để chọn.
 *
 * Nút "Đặt phòng" trên header thì chỉ bắn toast lộ mã task nội bộ
 * ("Đặt phòng nhanh mở từ calendar — task 6.2/6.3") dù /bookings/new đã chạy đủ.
 */
const PASSWORD = 'E2e@Onboard2026';

test('tenant mới chưa có cơ sở → bị đưa thẳng vào màn thiết lập', async ({ page }) => {
  const unique = Date.now();

  await page.goto('/register');
  await page.getByLabel('Tên cơ sở kinh doanh').fill('Homestay Onboarding');
  await page.getByLabel('Tên miền riêng').fill(`e2e-onb-${unique}`);
  await page.getByLabel('Họ tên của bạn').fill('Chủ Nhà Mới');
  await page.getByLabel('Email').fill(`onb-${unique}@e2e.test`);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

  await expect(page.getByLabel('Không gian làm việc')).toHaveValue(`e2e-onb-${unique}`);
  await page.getByLabel('Email').fill(`onb-${unique}@e2e.test`);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();

  // Không dừng ở dashboard: đưa thẳng tới chỗ tạo cơ sở, form mở sẵn.
  await expect(page).toHaveURL(/\/properties\?setup=1$/);
  await expect(page.locator('h1')).toHaveText('Thiết lập cơ sở đầu tiên');
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Thêm cơ sở' })).toBeVisible();

  // Dialog là modal — Radix gán aria-hidden cho phần còn lại của trang, nên
  // getByRole KHÔNG thấy header khi nó còn mở. Đóng lại rồi mới soi shell.
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Header: KHÔNG còn selectbox rỗng, thay bằng đúng một lối đi.
  const header = page.locator('header');
  await expect(header.getByRole('link', { name: 'Tạo cơ sở đầu tiên' })).toBeVisible();
  // Đặt phòng phải vô hiệu — chưa có cơ sở thì form đặt phòng không chạy được.
  await expect(header.getByRole('button', { name: 'Đặt phòng' })).toBeDisabled();

  // Tên người dùng thật, không phải "Chủ Demo" hardcode.
  await expect(page.locator('aside').getByText('Chủ Nhà Mới')).toBeVisible();
});

test('nút "Đặt phòng" trên header mở form tạo đặt phòng', async ({ page }) => {
  await loginDemo(page);

  const button = page.locator('header').getByRole('button', { name: 'Đặt phòng' });
  await expect(button).toBeEnabled(); // tenant demo đã có cơ sở
  await button.click();

  await expect(page).toHaveURL(/\/bookings\/new$/);
  await expect(page.getByRole('heading', { name: 'Đặt phòng mới' })).toBeVisible();
});

/**
 * Hồi quy: cookie csrf_token từng đặt HttpOnly + Path=/api/v1/auth nên JS không đọc
 * lại được sau khi tải lại trang → /auth/refresh trả 403 → đá về /login. Nghĩa là
 * cứ F5 là đăng xuất, và người dùng cảm nhận thành "chuyển trang rất lâu".
 */
test('tải lại trang giữ nguyên phiên, không đá về /login', async ({ page }) => {
  await loginDemo(page);
  await page.goto('/bookings');
  await expect(page.getByRole('heading', { name: 'Đặt phòng', exact: true })).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(/\/bookings$/);
  await expect(page.getByRole('heading', { name: 'Đặt phòng', exact: true })).toBeVisible();
  // Double-submit chỉ chạy được khi JS đọc được cookie.
  expect(await page.evaluate(() => /(?:^|;\s*)csrf_token=/.test(document.cookie))).toBe(true);
});

test('trang danh sách đặt phòng có lối tạo mới', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Đặt phòng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Đặt phòng', exact: true })).toBeVisible();

  // Trước đây trang này chỉ có filter + bảng, không có đường nào tạo booking.
  await page.getByRole('main').getByRole('button', { name: 'Đặt phòng' }).click();
  await expect(page).toHaveURL(/\/bookings\/new$/);
});
