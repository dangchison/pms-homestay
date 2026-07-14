import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Ca thu ngân web-staff (task 2.10b, docs/16 #10). STAFF (letan@demo.vn) mở/đóng ca
 * ngay trên /profile; state ca mở giữ ở localStorage (STAFF thiếu `report.financial`
 * nên KHÔNG GET /shifts). HOUSEKEEPER không thấy card.
 *
 * ⚠️ ĐIỀU HƯỚNG CLIENT-SIDE (KHÔNG page.goto sau đăng nhập): access-token + cơ sở giữ
 * IN-MEMORY (docs/13 §3). page.goto/reload = hard reload → mất phiên → refresh KHÔNG kèm
 * CSRF → 403 → đá về /login. Vào /profile qua tab "Cá nhân" (giữ phiên) như mọi spec.
 *
 * Server state dàn dựng qua API owner (owner@demo.vn có report.financial + payment.reconcile):
 * đóng sạch ca seed / hoặc ép có 1 ca mở. Chạy trực tiếp (KHÔNG rtk): cần stack api :3001
 * + web-staff next start :3002 + db:seed:dev.
 */
const API = 'http://localhost:3001/api/v1';
const DEMO = { tenant: 'demo', owner: 'owner@demo.vn', password: 'Demo@2026!' };

interface OwnerShift {
  id: string;
  property_id: string;
  version: number;
}

async function ownerHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.post(`${API}/auth/login`, {
    headers: { 'X-Tenant-Slug': DEMO.tenant },
    data: { email: DEMO.owner, password: DEMO.password },
  });
  expect(res.ok(), 'owner login').toBeTruthy();
  const token = ((await res.json()) as { data: { access_token: string } }).data.access_token;
  return { Authorization: `Bearer ${token}`, 'X-Tenant-Slug': DEMO.tenant };
}

async function listOpenShifts(request: APIRequestContext, headers: Record<string, string>): Promise<OwnerShift[]> {
  const res = await request.get(`${API}/shifts?status=OPEN&page_size=100`, { headers });
  expect(res.ok(), 'GET /shifts?status=OPEN').toBeTruthy();
  return ((await res.json()) as { data: OwnerShift[] }).data;
}

async function ownerPropertyId(request: APIRequestContext, headers: Record<string, string>): Promise<string> {
  const res = await request.get(`${API}/properties?page_size=100`, { headers });
  expect(res.ok(), 'GET /properties').toBeTruthy();
  const props = ((await res.json()) as { data: { id: string }[] }).data;
  expect(props.length, 'demo có ít nhất 1 cơ sở').toBeGreaterThan(0);
  return props[0]!.id;
}

/** Đóng sạch mọi ca đang mở (đưa cơ sở về "chưa có ca mở" trên server). */
async function ensureNoOpenShift(request: APIRequestContext, headers: Record<string, string>): Promise<void> {
  for (const s of await listOpenShifts(request, headers)) {
    const res = await request.post(`${API}/shifts/${s.id}/close`, {
      headers: { ...headers, 'If-Match': String(s.version) },
      data: { closing_counted_vnd: 0 },
    });
    expect(res.ok(), `close open shift ${s.id}`).toBeTruthy();
  }
}

/** Đảm bảo cơ sở đang có đúng 1 ca mở (để STAFF mở ca → 409). */
async function ensureOpenShift(request: APIRequestContext, headers: Record<string, string>): Promise<void> {
  if ((await listOpenShifts(request, headers)).length > 0) return;
  const propertyId = await ownerPropertyId(request, headers);
  const res = await request.post(`${API}/shifts`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { property_id: propertyId, opening_float_vnd: 0 },
  });
  expect(res.ok(), 'open shift (arrange)').toBeTruthy();
}

/** Vào trang Cá nhân bằng điều hướng client-side (giữ phiên in-memory). */
async function gotoProfile(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Cá nhân', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cá nhân' })).toBeVisible();
}

test.describe('web-staff — ca thu ngân (STAFF)', () => {
  test('mở → persist qua reload → đóng ca (variance đỏ), không GET /shifts', async ({ page, request }) => {
    await ensureNoOpenShift(request, await ownerHeaders(request));

    // Chứng minh app STAFF KHÔNG bao giờ GET /shifts (thiếu report.financial).
    const shiftGets: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'GET' && r.url().includes('/api/v1/shifts')) shiftGets.push(r.url());
    });

    await loginDemo(page, 'reception');
    await gotoProfile(page);
    await expect(page.getByText('Ca thu ngân')).toBeVisible();
    await expect(page.getByText('Chưa mở ca')).toBeVisible();

    // Mở ca — float 500.000.
    await page.getByRole('button', { name: 'Mở ca' }).click();
    await page.getByLabel('Tiền đầu ca').fill('500000');
    await page.getByRole('dialog').getByRole('button', { name: 'Mở ca' }).click();
    await expect(page.getByText('Ca đang mở')).toBeVisible();

    // Reload = hard reload → mất phiên in-memory (auth) → /login; NHƯNG shift state ở
    // localStorage sống sót. Đăng nhập lại + vào /profile → card đọc 'Ca đang mở' từ
    // localStorage (chứng minh persist; auth in-memory thì KHÔNG sống qua reload).
    await page.reload();
    await loginDemo(page, 'reception');
    await gotoProfile(page);
    await expect(page.getByText('Ca đang mở')).toBeVisible();

    // Đóng ca — đếm 300.000 → chênh lệch −200.000₫ (đỏ vì ≠ 0).
    await page.getByRole('button', { name: 'Đóng ca' }).click();
    await page.getByLabel('Tiền đếm thực').fill('300000');
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng ca' }).click();

    const variance = page.getByTestId('shift-variance');
    await expect(variance).toHaveText('-200.000₫');
    await expect(variance).toHaveClass(/text-destructive/);
    await expect(page.getByText('Chưa mở ca')).toBeVisible(); // ca mở cục bộ đã xoá

    expect(shiftGets, 'app STAFF không GET /shifts').toEqual([]);
  });

  test('mở ca khi cơ sở đã có ca mở nơi khác → toast, không ghi state cục bộ', async ({ page, request }) => {
    await ensureOpenShift(request, await ownerHeaders(request));

    await loginDemo(page, 'reception');
    await gotoProfile(page);
    await expect(page.getByText('Chưa mở ca')).toBeVisible();

    await page.getByRole('button', { name: 'Mở ca' }).click();
    await page.getByLabel('Tiền đầu ca').fill('200000');
    await page.getByRole('dialog').getByRole('button', { name: 'Mở ca' }).click();

    await expect(page.getByText(/^Cơ sở đang có ca mở/)).toBeVisible();
    await expect(page.getByText('Chưa mở ca')).toBeVisible(); // vẫn chưa mở ca
    await expect(page.getByText('Ca đang mở')).toHaveCount(0);
  });

  test('offline → nút Mở ca bị disable (thao tác ghi cần online)', async ({ page }) => {
    await loginDemo(page, 'reception');
    await gotoProfile(page);
    const moCa = page.getByRole('button', { name: 'Mở ca' });
    await expect(moCa).toBeEnabled(); // online + đã có cơ sở

    await page.context().setOffline(true);
    await expect(moCa).toBeDisabled();
    await page.context().setOffline(false);
  });
});

test.describe('web-staff — ca thu ngân (HOUSEKEEPER)', () => {
  test('không thấy card Ca thu ngân', async ({ page }) => {
    await loginDemo(page, 'housekeeper');
    await gotoProfile(page); // đã assert trang Cá nhân tải xong
    await expect(page.getByText('Ca thu ngân')).toHaveCount(0);
  });
});
