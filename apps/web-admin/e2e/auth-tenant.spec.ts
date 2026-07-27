import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Hồi quy: đăng ký tenant riêng xong KHÔNG đăng nhập được.
 *
 * `users` unique theo `(tenant_id, email)` chứ không unique toàn cục, nên BE tìm
 * user trong đúng MỘT tenant lấy từ header `X-Tenant-Slug`. Trên localhost không
 * có subdomain, FE từng luôn gửi `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` (= `demo`):
 * người vừa tạo tenant riêng nhập đúng mật khẩu vẫn nhận
 * "Email hoặc mật khẩu không đúng" vì tìm nhầm tenant.
 *
 * Hai test dưới khoá cả hai chiều: tenant tự đăng ký vào được, và nút demo không
 * bị slug đã ghi nhớ của tenant kia kéo đi nhầm chỗ.
 */
const PASSWORD = 'E2e@Tenant2026';

test('đăng ký tenant riêng rồi đăng nhập được ngay trên cùng trình duyệt', async ({ page }) => {
  const unique = Date.now();
  const slug = `e2e-tenant-${unique}`;
  const email = `owner-${unique}@e2e.test`;

  await page.goto('/register');
  await page.getByLabel('Tên cơ sở kinh doanh').fill('Homestay E2E');
  await page.getByLabel('Tên miền riêng').fill(slug);
  await page.getByLabel('Họ tên của bạn').fill('Chủ Nhà E2E');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

  // Đăng ký xong → về /login, ô không gian làm việc đã điền sẵn tenant vừa tạo.
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
  await expect(page.getByLabel('Không gian làm việc')).toHaveValue(slug);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();

  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
});

test('nút demo vẫn vào đúng tenant demo dù trình duyệt đã nhớ tenant khác', async ({ page }) => {
  const unique = Date.now();
  const slug = `e2e-other-${unique}`;

  await page.goto('/register');
  await page.getByLabel('Tên cơ sở kinh doanh').fill('Homestay Khác');
  await page.getByLabel('Tên miền riêng').fill(slug);
  await page.getByLabel('Họ tên của bạn').fill('Chủ Nhà Khác');
  await page.getByLabel('Email').fill(`other-${unique}@e2e.test`);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(page.getByLabel('Không gian làm việc')).toHaveValue(slug);

  // Nút demo phải tự ép slug `demo`, không dùng slug vừa ghi nhớ ở trên.
  await loginDemo(page);
});
