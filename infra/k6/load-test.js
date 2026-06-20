// Load test k6 — PMS API (task 8.3, docs/11 §10 performance budget).
//
// ⚠️ Scenario `book` GHI DỮ LIỆU (tạo booking). Chạy vào STAGING/throwaway có seed,
//    TUYỆT ĐỐI không phải prod. browse/quote chỉ đọc.
//
// Chạy:
//   k6 run -e TARGET_URL=https://staging.api -e TENANT_SLUG=demo \
//          -e LOAD_EMAIL=owner@demo.vn -e LOAD_PASSWORD=... infra/k6/load-test.js
//
// Budget (docs/11 §10) cài thành threshold → k6 exit≠0 nếu vượt (CI đỏ).
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

const TARGET = __ENV.TARGET_URL || 'http://localhost:3001';
const TENANT = __ENV.TENANT_SLUG || 'demo';
const EMAIL = __ENV.LOAD_EMAIL || 'owner@demo.vn';
const PASSWORD = __ENV.LOAD_PASSWORD || 'Demo@2026!';
const BOOKINGS = Number(__ENV.BOOKINGS || 1000); // tổng booking scenario `book` tạo

export const options = {
  scenarios: {
    // 100 concurrent users duyệt (đọc) — ramp lên rồi giữ.
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '2m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      tags: { scenario: 'browse' },
    },
    // Báo giá realtime — endpoint nóng nhất ở form đặt phòng.
    quote: {
      executor: 'constant-vus',
      exec: 'quote',
      vus: 20,
      duration: '3m',
      tags: { scenario: 'quote' },
    },
    // 1000 booking (GHI) — chia iteration, mỗi cái ngày riêng để không overbooking.
    book: {
      executor: 'shared-iterations',
      exec: 'book',
      vus: 20,
      iterations: BOOKINGS,
      maxDuration: '10m',
      tags: { scenario: 'book' },
    },
  },
  thresholds: {
    'http_req_duration{kind:list}': ['p(95)<200'],
    'http_req_duration{kind:detail}': ['p(95)<100'],
    'http_req_duration{kind:quote}': ['p(95)<100'],
    'http_req_duration{kind:report}': ['p(95)<300'],
    'http_req_duration{kind:mutation}': ['p(95)<400'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

function listOf(body) {
  return Array.isArray(body) ? body : (body && body.data) || [];
}

// setup() chạy 1 lần: login + lấy property/resource dùng chung cho mọi VU.
export function setup() {
  const res = http.post(`${TARGET}/api/v1/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': TENANT },
  });
  if (res.status !== 200) throw new Error(`login thất bại: ${res.status} ${res.body}`);
  const token = res.json('access_token');
  const h = { headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Slug': TENANT } };

  const props = listOf(http.get(`${TARGET}/api/v1/properties`, h).json());
  if (!props.length) throw new Error('không có property nào để load test');
  const propertyId = props[0].id;

  const resources = listOf(http.get(`${TARGET}/api/v1/bookable-resources?property_id=${propertyId}`, h).json());
  const rooms = resources.filter((r) => r.type === 'ROOM');
  const pool = (rooms.length ? rooms : resources).map((r) => r.id);
  if (!pool.length) throw new Error('không có bookable_resource nào');

  return { token, propertyId, resourceId: pool[0], resourcePool: pool };
}

function auth(data) {
  return { Authorization: `Bearer ${data.token}`, 'X-Tenant-Slug': TENANT };
}

// Đọc: danh sách + chi tiết + báo cáo (gắn tag kind để chấm budget riêng).
export function browse(data) {
  const headers = auth(data);
  const list = http.get(`${TARGET}/api/v1/bookings?property_id=${data.propertyId}&page=1&page_size=20`, {
    headers,
    tags: { kind: 'list' },
  });
  check(list, { 'list 200': (r) => r.status === 200 });

  const items = listOf(list.json());
  if (items.length) {
    const detail = http.get(`${TARGET}/api/v1/bookings/${items[0].id}`, { headers, tags: { kind: 'detail' } });
    check(detail, { 'detail 200': (r) => r.status === 200 });
  }

  const month = new Date().toISOString().slice(0, 7);
  const rep = http.get(
    `${TARGET}/api/v1/reports/occupancy?property_id=${data.propertyId}&from=${month}-01&to=${month}-28`,
    { headers, tags: { kind: 'report' } },
  );
  check(rep, { 'report 2xx': (r) => r.status === 200 });
}

function quotePayload(data, dayOffset) {
  const ci = new Date(Date.now() + dayOffset * 86400000);
  ci.setUTCHours(6, 0, 0, 0);
  const co = new Date(ci.getTime() + 86400000);
  return {
    resource_id: data.resourcePool[dayOffset % data.resourcePool.length],
    mode: 'DAILY',
    check_in: ci.toISOString(),
    check_out: co.toISOString(),
    adults: 2,
  };
}

// Báo giá (chỉ đọc, không giữ chỗ).
export function quote(data) {
  const headers = { ...auth(data), 'Content-Type': 'application/json' };
  const offset = 30 + (exec.scenario.iterationInTest % 700);
  const res = http.post(`${TARGET}/api/v1/pricing/quote`, JSON.stringify(quotePayload(data, offset)), {
    headers,
    tags: { kind: 'quote' },
  });
  check(res, { 'quote 2xx': (r) => r.status === 200 });
}

// Tạo booking: quote → POST /bookings (Idempotency-Key). Mỗi iteration 1 ngày
// riêng/1 resource → không đụng occupancy (409 BOOKING_OVERLAP chỉ đếm, không fail).
export function book(data) {
  const headers = { ...auth(data), 'Content-Type': 'application/json' };
  // +400 ngày trở đi để không đụng dải ngày seed/scenario quote.
  const offset = 400 + exec.scenario.iterationInTest;
  const payload = quotePayload(data, offset);

  const q = http.post(`${TARGET}/api/v1/pricing/quote`, JSON.stringify(payload), {
    headers,
    tags: { kind: 'quote' },
  });
  if (q.status !== 200) {
    check(q, { 'book.quote 2xx': () => false });
    return;
  }

  const body = JSON.stringify({
    resource_id: payload.resource_id,
    quote_id: q.json('quote_id'),
    mode: 'DAILY',
    check_in: payload.check_in,
    check_out: payload.check_out,
    adults: 2,
  });
  const res = http.post(`${TARGET}/api/v1/bookings`, body, {
    headers: { ...headers, 'Idempotency-Key': `k6-${exec.scenario.iterationInTest}-${exec.vu.idInTest}` },
    tags: { kind: 'mutation' },
  });
  // 201 tạo mới · 409 overlap (chấp nhận khi tải cao) — đều KHÔNG tính là lỗi budget.
  check(res, { 'book created/dedup/overlap': (r) => [200, 201, 409].includes(r.status) });
}
