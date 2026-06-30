import { test, expect } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Smoke điều hướng web-staff (docs/18 P2-A2): đăng nhập demo theo vai + các trang
 * chính render đúng — bắt lỗi FE trắng/vỡ mà typecheck/build không thấy. Tab dưới
 * theo vai (HOUSEKEEPER không có "Hôm nay").
 */
test.describe('web-staff smoke — lễ tân (STAFF)', () => {
  test('đăng nhập demo → bảng hôm nay (đến/đi/đang ở)', async ({ page }) => {
    await loginDemo(page, 'reception');
    await expect(page.getByRole('heading', { name: 'Hôm nay' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Khách đến' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Khách đi' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Đang ở' })).toBeVisible();
  });

  test('điều hướng tab dưới → các trang chính render', async ({ page }) => {
    await loginDemo(page, 'reception');

    // exact: true — "Phòng" không khớp nhầm "Dọn phòng".
    await page.getByRole('link', { name: 'Dọn phòng', exact: true }).click();
    await expect(page).toHaveURL(/\/cleaning$/);
    await expect(page.getByRole('heading', { name: 'Dọn phòng' })).toBeVisible();

    await page.getByRole('link', { name: 'Phòng', exact: true }).click();
    await expect(page).toHaveURL(/\/rooms$/);
    await expect(page.getByRole('heading', { name: 'Phòng' })).toBeVisible();

    await page.getByRole('link', { name: 'Cá nhân', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('heading', { name: 'Cá nhân' })).toBeVisible();

    await page.getByRole('link', { name: 'Hôm nay', exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole('heading', { name: 'Hôm nay' })).toBeVisible();
  });
});

test.describe('web-staff smoke — buồng phòng (HOUSEKEEPER)', () => {
  test('đăng nhập demo → vào thẳng Dọn phòng, không có tab "Hôm nay"', async ({ page }) => {
    await loginDemo(page, 'housekeeper');
    await expect(page).toHaveURL(/\/cleaning$/);
    await expect(page.getByRole('heading', { name: 'Dọn phòng' })).toBeVisible();

    // HOUSEKEEPER không thấy tab "Hôm nay" (không có quyền xem lịch đến/đi).
    await expect(page.getByRole('link', { name: 'Hôm nay', exact: true })).toHaveCount(0);

    await page.getByRole('link', { name: 'Phòng', exact: true }).click();
    await expect(page).toHaveURL(/\/rooms$/);
    await expect(page.getByRole('heading', { name: 'Phòng' })).toBeVisible();

    await page.getByRole('link', { name: 'Cá nhân', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('heading', { name: 'Cá nhân' })).toBeVisible();
    await expect(page.getByText('Buồng phòng Demo')).toBeVisible(); // đúng tài khoản buồng phòng
  });
});

test.describe('web-staff — luồng check-in', () => {
  test('chạm khách đến → quét/nhập tay giấy tờ → cổng consent NĐ13 chặn khi chưa đồng ý', async ({
    page,
  }) => {
    await loginDemo(page, 'reception');

    // Seed có 2 khách CONFIRMED đến hôm nay → có card check-in (href /checkin/:id).
    const firstArrival = page.locator('a[href^="/checkin/"]').first();
    await expect(firstArrival).toBeVisible();
    await firstArrival.click();
    await expect(page).toHaveURL(/\/checkin\//);

    // Bước 1: điểm vào OCR (camera) + lối nhập tay.
    await expect(page.getByRole('heading', { name: /Check-in/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Chụp \/ chọn ảnh CCCD/ })).toBeVisible();
    const manual = page.getByRole('button', { name: 'Nhập tay (bỏ qua OCR)' });
    await expect(manual).toBeVisible();
    await manual.click();

    // Bước 2: form + checkbox đồng ý xử lý dữ liệu cá nhân (Nghị định 13/2023).
    await expect(page.getByText(/Khách đồng ý cho cơ sở xử lý dữ liệu cá nhân/)).toBeVisible();
    const next = page.getByRole('button', { name: 'Tiếp tục' });
    await expect(next).toBeVisible();

    // Bấm Tiếp tục khi CHƯA tích đồng ý → bị chặn (không sang bước "Nhận phòng").
    await next.click();
    await expect(page.getByRole('button', { name: 'Nhận phòng' })).toHaveCount(0);
    await expect(next).toBeVisible(); // vẫn ở bước 2
  });
});
