// SSE soak k6 — giữ 500 kết nối realtime đồng thời (task 8.3, docs/11 §10).
//
// Yêu cầu k6 ≥ 0.59 (module experimental `k6/experimental/sse`). Chỉ ĐỌC (mở
// /events/stream) → an toàn chạy vào staging.
//
// Chạy:
//   k6 run -e TARGET_URL=https://staging.api -e TENANT_SLUG=demo \
//          -e LOAD_EMAIL=owner@demo.vn -e LOAD_PASSWORD=... infra/k6/sse-soak.js
import sse from 'k6/experimental/sse';
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const TARGET = __ENV.TARGET_URL || 'http://localhost:3001';
const TENANT = __ENV.TENANT_SLUG || 'demo';
const EMAIL = __ENV.LOAD_EMAIL || 'owner@demo.vn';
const PASSWORD = __ENV.LOAD_PASSWORD || 'Demo@2026!';
const CONNECTIONS = Number(__ENV.SSE_CONNECTIONS || 500);
const HOLD = __ENV.SSE_HOLD || '2m';

const eventsReceived = new Counter('sse_events_received');
const connErrors = new Counter('sse_connection_errors');

export const options = {
  scenarios: {
    // Mỗi VU giữ 1 kết nối SSE suốt thời lượng → CONNECTIONS kết nối đồng thời.
    sse: { executor: 'constant-vus', vus: CONNECTIONS, duration: HOLD, gracefulStop: '10s' },
  },
  thresholds: {
    sse_connection_errors: ['count<1'], // không kết nối nào lỗi
  },
};

export function setup() {
  const res = http.post(`${TARGET}/api/v1/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': TENANT },
  });
  if (res.status !== 200) throw new Error(`login thất bại: ${res.status}`);
  return { token: res.json('access_token') };
}

export default function (data) {
  const url = `${TARGET}/api/v1/events/stream`;
  const params = { headers: { Authorization: `Bearer ${data.token}`, 'X-Tenant-Slug': TENANT } };

  const res = sse.open(url, params, function (client) {
    client.on('event', function () {
      eventsReceived.add(1);
    });
    client.on('error', function () {
      connErrors.add(1);
    });
  });

  check(res, { 'SSE mở 200': (r) => r && r.status === 200 });
}
