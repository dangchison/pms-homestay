/**
 * Seed DEV: tenant + TÀI KHOẢN DEMO + DỮ LIỆU MẪU để thử nghiệm local / demo cho
 * khách hàng (marketing). KHÔNG chạy ở production. Idempotent — upsert tenant/user/
 * cơ sở; với dữ liệu giao dịch (phòng, booking, hoá đơn…) thì RESET rồi nạp lại mỗi
 * lần chạy để có một bộ demo tươi, nhất quán.
 *
 * Sau khi chạy, đăng nhập web-admin (OWNER) / web-staff (lễ tân, buồng phòng) bằng
 * tenant `demo` + email dưới đây + cùng 1 mật khẩu. Đặt NEXT_PUBLIC_DEFAULT_TENANT_SLUG=demo
 * để login localhost nhận đúng tenant (web-admin không có ô nhập tenant).
 *
 * Dữ liệu mẫu rải theo `now()` của DB (KHÔNG hardcode ngày) nên Lịch / Hôm nay /
 * Hoá đơn / Báo cáo luôn có dữ liệu quanh "hôm nay", bất kể chạy ngày nào.
 *
 * Chạy: pnpm db:seed:dev (sau pnpm db:seed:required)
 */
import 'dotenv/config';
import * as argon2 from 'argon2';
import { Client } from 'pg';

const TENANT_SLUG = 'demo';
/** Mật khẩu demo dùng chung (≥10 ký tự theo LoginRequestSchema). Đổi nếu công khai. */
const DEMO_PASSWORD = 'Demo@2026!';

/** Tài khoản demo theo từng vai trò — showcase web-admin (OWNER) + web-staff (STAFF/HOUSEKEEPER). */
const DEMO_USERS = [
  { email: 'owner@demo.vn', fullName: 'Chủ nhà Demo', role: 'OWNER', scopedToProperty: false },
  { email: 'letan@demo.vn', fullName: 'Lễ tân Demo', role: 'STAFF', scopedToProperty: true },
  { email: 'buongphong@demo.vn', fullName: 'Buồng phòng Demo', role: 'HOUSEKEEPER', scopedToProperty: true },
] as const;

const PROPERTY_NAME = 'Cơ sở Demo — Mỹ Khê';

/** Tài khoản nhận tiền VietQR cho cơ sở demo (BIN NAPAS hợp lệ — MB Bank) → panel QR ở invoice/checkout hoạt động thay vì 422. */
const DEMO_BANK = { bin: '970422', account: '0901234567', name: 'DEMO HOMESTAY DA NANG' } as const;

/** Giá/đêm (VND) — total_amount_vnd của booking là snapshot, độc lập rate_plan. */
const NIGHTLY_ROOM_VND = 700_000;
const NIGHTLY_WHOLE_VND = 1_600_000;
/** Thuê tháng (bước 14) — nguồn số DUY NHẤT cho rate plan MONTHLY, chỉ số công tơ và
 *  hoá đơn MONTHLY_RENT: quantity/amount/description/total đều dẫn xuất từ đây
 *  (sửa 1 chỗ, demo không lệch ngầm giữa rate plan ↔ meter ↔ invoice). */
const MONTHLY_RENT_VND = 6_500_000;
const ELEC_PER_KWH_VND = 3_500;
const WATER_PER_M3_VND = 15_000;
/** Chỉ số công tơ kỳ TRƯỚC (start→end); kỳ NÀY mở đầu bằng đúng chỉ số end kỳ trước. */
const METER = { elecStart: 1250.0, elecEnd: 1375.5, waterStart: 56.0, waterEnd: 61.5 } as const;
const TZ = 'Asia/Ho_Chi_Minh';

async function upsertUser(
  client: Client,
  tenantId: string,
  email: string,
  fullName: string,
  role: string,
  passwordHash: string,
): Promise<string> {
  // partial unique (tenant_id, email) WHERE deleted_at IS NULL → upsert thủ công.
  const updated = await client.query<{ id: string }>(
    `UPDATE users
       SET full_name = $3, default_role = $4, password_hash = $5, is_active = true
     WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL
     RETURNING id`,
    [tenantId, email, fullName, role, passwordHash],
  );
  if (updated.rowCount && updated.rowCount > 0) return updated.rows[0]!.id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, full_name, default_role, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id`,
    [tenantId, email, fullName, role, passwordHash],
  );
  return inserted.rows[0]!.id;
}

// ── DỮ LIỆU MẪU ──────────────────────────────────────────────────────────────

/** Phòng demo: số phòng + tên + trạng thái buồng phòng (đồng bộ với task dọn bên dưới). */
const ROOMS = [
  { number: '101', name: 'Phòng 101 — Hướng biển', hk: 'CLEAN', cap: 2 },
  { number: '102', name: 'Phòng 102 — Hướng biển', hk: 'DIRTY', cap: 2 },
  { number: '103', name: 'Phòng 103 — Ban công', hk: 'CLEAN', cap: 3 },
  { number: '201', name: 'Phòng 201 — Deluxe', hk: 'CLEAN', cap: 2 },
  { number: '202', name: 'Phòng 202 — Deluxe', hk: 'CLEANING', cap: 2 },
  { number: '203', name: 'Phòng 203 — Gia đình', hk: 'CLEAN', cap: 4 },
  { number: '301', name: 'Phòng 301 — Penthouse', hk: 'INSPECTION', cap: 2 },
  { number: '302', name: 'Phòng 302 — Penthouse', hk: 'CLEAN', cap: 2 },
] as const;

const GUEST_NAMES = [
  'Nguyễn Văn An', 'Trần Thị Bình', 'Lê Hoàng Cường', 'Phạm Thu Dung',
  'Hoàng Minh Đức', 'Vũ Thị Hà', 'Đỗ Quang Huy', 'Bùi Khánh Linh',
  'Đặng Văn Nam', 'Ngô Thị Oanh', 'Dương Tấn Phát', 'Lý Thị Quỳnh',
] as const;

/** roomIdx: chỉ số trong ROOMS (0..7) hoặc 'WHOLE' (nguyên căn 301+302). */
type BookingSpec = {
  room: number | 'WHOLE';
  inOff: number; // ngày so với hôm nay
  outOff: number;
  inH: number; // giờ nhận (VN)
  outH: number; // giờ trả (VN)
  status: 'HOLD' | 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
  source: string;
  guest: number;
};

// Bố trí để mỗi phòng KHÔNG có 2 occupancy chồng nhau (EXCLUDE vô điều kiện).
// Quá khứ CHECKED_OUT không sinh occupancy (lịch loại terminal) nên không tính trùng.
const BOOKINGS: BookingSpec[] = [
  // ── Quá khứ — CHECKED_OUT (không occupancy; hiện ở danh sách/hoá đơn/báo cáo) ──
  { room: 0, inOff: -10, outOff: -7, inH: 14, outH: 12, status: 'CHECKED_OUT', source: 'DIRECT', guest: 0 },
  { room: 1, inOff: -8, outOff: -5, inH: 15, outH: 11, status: 'CHECKED_OUT', source: 'AIRBNB_ICAL', guest: 1 },
  { room: 2, inOff: -5, outOff: -2, inH: 16, outH: 12, status: 'CHECKED_OUT', source: 'BOOKING_ICAL', guest: 3 },
  // ── Đang ở — CHECKED_IN ──
  { room: 0, inOff: -1, outOff: 2, inH: 14, outH: 12, status: 'CHECKED_IN', source: 'DIRECT', guest: 4 },
  { room: 5, inOff: -2, outOff: 1, inH: 14, outH: 12, status: 'CHECKED_IN', source: 'AIRBNB_ICAL', guest: 5 },
  // ── Đến hôm nay — CONFIRMED (check_in hôm nay) ──
  { room: 2, inOff: 0, outOff: 2, inH: 14, outH: 12, status: 'CONFIRMED', source: 'DIRECT', guest: 6 },
  { room: 3, inOff: 0, outOff: 4, inH: 15, outH: 12, status: 'CONFIRMED', source: 'WALK_IN', guest: 7 },
  // ── Đi hôm nay — CHECKED_IN (check_out hôm nay) ──
  { room: 1, inOff: -3, outOff: 0, inH: 14, outH: 12, status: 'CHECKED_IN', source: 'DIRECT', guest: 8 },
  { room: 4, inOff: -2, outOff: 0, inH: 14, outH: 11, status: 'CHECKED_IN', source: 'AGODA_ICAL', guest: 9 },
  // ── Tương lai — CONFIRMED / PENDING ──
  { room: 0, inOff: 5, outOff: 8, inH: 14, outH: 12, status: 'CONFIRMED', source: 'DIRECT', guest: 10 },
  { room: 1, inOff: 3, outOff: 6, inH: 14, outH: 12, status: 'PENDING', source: 'AIRBNB_ICAL', guest: 11 },
  { room: 3, inOff: 6, outOff: 9, inH: 14, outH: 12, status: 'CONFIRMED', source: 'BOOKING_ICAL', guest: 0 },
  { room: 4, inOff: 4, outOff: 7, inH: 14, outH: 12, status: 'PENDING', source: 'DIRECT', guest: 1 },
  { room: 6, inOff: 2, outOff: 5, inH: 14, outH: 12, status: 'CONFIRMED', source: 'DIRECT', guest: 2 },
  { room: 7, inOff: 8, outOff: 11, inH: 14, outH: 12, status: 'CONFIRMED', source: 'WALK_IN', guest: 3 },
  // ── HOLD tạm ──
  { room: 2, inOff: 10, outOff: 12, inH: 14, outH: 12, status: 'HOLD', source: 'DIRECT', guest: 4 },
  // ── Nguyên căn (301+302) — CONFIRMED, cửa sổ 301/302 đều rảnh ──
  { room: 'WHOLE', inOff: 13, outOff: 16, inH: 14, outH: 12, status: 'CONFIRMED', source: 'DIRECT', guest: 5 },
  // ── Fixture anti-fraud Đợt 3 (docs/19 §4) — status terminal nên KHÔNG sinh
  //    room_occupancy → không thể vỡ EXCLUDE dù trùng phòng/ngày với booking khác. ──
  // F1 (idx 17): hủy SAU khi đã thu cọc CASH → finding CANCEL_AFTER_CASH (bước 12).
  { room: 3, inOff: 1, outOff: 3, inH: 14, outH: 12, status: 'CANCELLED', source: 'DIRECT', guest: 9 },
  // F2 (idx 18): đã trả phòng rồi hoàn TOÀN BỘ tiền mặt — cố ý dưới ngưỡng
  //    REFUND_ANOMALY_BY_STAFF để không sinh finding nhiễu (bước 12).
  { room: 7, inOff: -6, outOff: -4, inH: 14, outH: 12, status: 'CHECKED_OUT', source: 'DIRECT', guest: 10 },
];

const NON_TERMINAL = new Set(['HOLD', 'PENDING', 'CONFIRMED', 'CHECKED_IN']);

/** Ngày VN dạng 'YYYY-MM-DD' cho offset ngày so với `anchor` (toán UTC để không lệch TZ máy). */
function ymd(anchor: Date, offsetDays: number): string {
  const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + offsetDays));
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}
/** Chuỗi timestamp local VN 'YYYY-MM-DD HH:00:00' — insert kèm ::timestamp AT TIME ZONE TZ. */
function vnLocal(anchor: Date, offsetDays: number, hour: number): string {
  return `${ymd(anchor, offsetDays)} ${String(hour).padStart(2, '0')}:00:00`;
}
/** Kỳ tháng {y, m(1-12)} lùi `k` tháng so với todayStr 'YYYY-MM-DD' — thuần số học, không Date/TZ. */
function monthsBack(todayStr: string, k: number): { y: number; m: number } {
  const idx = Number(todayStr.slice(0, 4)) * 12 + Number(todayStr.slice(5, 7)) - 1 - k;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}
/** Ngày 01 của kỳ, dạng 'YYYY-MM-01' (insert kèm ::date). */
function firstOfMonth(p: { y: number; m: number }): string {
  return `${p.y}-${String(p.m).padStart(2, '0')}-01`;
}

async function seedDemoData(
  client: Client,
  tenantId: string,
  propertyId: string,
  userIds: { owner: string; letan: string; buongphong: string },
): Promise<void> {
  // Mốc "hôm nay" theo giờ VN (khớp bucket today-board) — neo mọi ngày tương đối.
  const { rows: todayRows } = await client.query<{ d: string }>(
    `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`,
    [TZ],
  );
  const todayStr = todayRows[0]!.d;
  const anchor = new Date(`${todayStr}T00:00:00Z`);
  const period = todayStr.slice(0, 7).replace('-', ''); // 'YYYYMM' cho document_counters

  // 1) RESET dữ liệu giao dịch của tenant demo (thứ tự FK an toàn).
  for (const sql of [
    // ── Bảng Đợt 3+ (docs/19 §4): xoá TRƯỚC bookings/guests/rooms/channels vì FK ──
    `DELETE FROM outbound_messages WHERE tenant_id = $1`, // FK bookings + guests (0035)
    `DELETE FROM notifications WHERE tenant_id = $1`, // FK users — users chỉ upsert, xoá noti để demo tươi
    `DELETE FROM sync_logs WHERE tenant_id = $1`, // FK sync_jobs (có CASCADE — vẫn xoá tường minh cho tự-tài-liệu)
    `DELETE FROM sync_jobs WHERE tenant_id = $1`, // FK channels
    `DELETE FROM channel_resource_mappings WHERE tenant_id = $1`, // FK channels + bookable_resources
    `DELETE FROM channels WHERE tenant_id = $1`,
    `DELETE FROM monthly_meter_readings WHERE tenant_id = $1`, // FK bookings
    `DELETE FROM booking_surcharges WHERE tenant_id = $1`, // FK bookings
    `DELETE FROM foreign_residence_declarations WHERE tenant_id = $1`, // FK bookings + guests
    `DELETE FROM cash_shifts WHERE tenant_id = $1`, // FK properties (properties chỉ upsert)
    `DELETE FROM unmatched_payments WHERE tenant_id = $1`, // chỉ FK tenants — resolved_payment_id KHÔNG có FK (0012)
    `DELETE FROM subscription_payments WHERE tenant_id = $1`, // chỉ FK tenants (bảng global, không RLS)
    `DELETE FROM depreciation_entries WHERE tenant_id = $1`, // FK assets
    `DELETE FROM assets WHERE tenant_id = $1`, // FK rooms
    `DELETE FROM operational_expenses WHERE tenant_id = $1`, // FK bookings (source_booking_id) + rooms
    `DELETE FROM payment_attempts WHERE tenant_id = $1`,
    `DELETE FROM payments WHERE tenant_id = $1`,
    `DELETE FROM invoice_items WHERE tenant_id = $1`,
    `DELETE FROM invoices WHERE tenant_id = $1`,
    `DELETE FROM cleaning_tasks WHERE tenant_id = $1`,
    `DELETE FROM room_occupancy WHERE tenant_id = $1`,
    `DELETE FROM booking_status_history WHERE tenant_id = $1`,
    `DELETE FROM bookings WHERE tenant_id = $1`,
    `DELETE FROM room_blocks WHERE tenant_id = $1`,
    // quotes do API (pricing-engine) tạo lúc đặt phòng, KHÔNG do seed sinh — nhưng có
    // FK tới rate_plans + bookable_resources → phải xoá TRƯỚC chúng, nếu không reseed
    // trên DB đã dùng sẽ vỡ FK quotes_*_rate_plan_id_fkey (bug re-run trước đây).
    `DELETE FROM quotes WHERE tenant_id = $1`,
    // discount_codes phải SAU quotes: quotes.discount_code_id FK composite
    // quotes_discount_code_fkey (0034) — xoá voucher trước sẽ vỡ FK trên DB có
    // quote dùng voucher (cùng lớp bug re-run như quotes↔rate_plans ở trên).
    `DELETE FROM discount_codes WHERE tenant_id = $1`,
    `DELETE FROM rate_plan_resources WHERE tenant_id = $1`,
    `DELETE FROM rate_plan_rules WHERE tenant_id = $1`,
    `DELETE FROM rate_plans WHERE tenant_id = $1`,
    `DELETE FROM resource_members WHERE tenant_id = $1`,
    `DELETE FROM bookable_resources WHERE tenant_id = $1`,
    `DELETE FROM guests WHERE tenant_id = $1`,
    `DELETE FROM rooms WHERE tenant_id = $1`,
    `DELETE FROM daily_property_stats WHERE tenant_id = $1`,
    `DELETE FROM document_counters WHERE tenant_id = $1`,
  ]) {
    await client.query(sql, [tenantId]);
  }

  // 2) Phòng + bookable_resource (ROOM 1:1) + resource_members.
  const roomIds: string[] = [];
  const roomResourceIds: string[] = [];
  for (const r of ROOMS) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO rooms (tenant_id, property_id, room_number, display_name, housekeeping_status, capacity_adults)
       VALUES ($1, $2, $3, $4, $5::housekeeping_status, $6) RETURNING id`,
      [tenantId, propertyId, r.number, r.name, r.hk, r.cap],
    );
    const roomId = rows[0]!.id;
    roomIds.push(roomId);
    const { rows: res } = await client.query<{ id: string }>(
      `INSERT INTO bookable_resources (tenant_id, property_id, type, name)
       VALUES ($1, $2, 'ROOM', $3) RETURNING id`,
      [tenantId, propertyId, r.name],
    );
    roomResourceIds.push(res[0]!.id);
    await client.query(
      `INSERT INTO resource_members (tenant_id, resource_id, room_id) VALUES ($1, $2, $3)`,
      [tenantId, res[0]!.id, roomId],
    );
  }

  // Nguyên căn tầng 3 = 301 (idx6) + 302 (idx7).
  const { rows: wholeRes } = await client.query<{ id: string }>(
    `INSERT INTO bookable_resources (tenant_id, property_id, type, name)
     VALUES ($1, $2, 'WHOLE', 'Nguyên căn Tầng 3 (301+302)') RETURNING id`,
    [tenantId, propertyId],
  );
  const wholeResourceId = wholeRes[0]!.id;
  for (const idx of [6, 7]) {
    await client.query(
      `INSERT INTO resource_members (tenant_id, resource_id, room_id) VALUES ($1, $2, $3)`,
      [tenantId, wholeResourceId, roomIds[idx]],
    );
  }

  // 3) Rate plans (DAILY mặc định + HOURLY) + gán cho mọi resource.
  const effFrom = ymd(anchor, -60);
  const { rows: dailyPlan } = await client.query<{ id: string }>(
    `INSERT INTO rate_plans (tenant_id, property_id, name, mode, is_default, base_price_vnd,
        deposit_type, deposit_value, daily_checkin_time, daily_checkout_time, effective_from)
     VALUES ($1, $2, 'Giá ngày tiêu chuẩn', 'DAILY', true, $3, 'PERCENT', 3000, '14:00', '12:00', $4)
     RETURNING id`,
    [tenantId, propertyId, NIGHTLY_ROOM_VND, effFrom],
  );
  await client.query(
    `INSERT INTO rate_plans (tenant_id, property_id, name, mode, is_default, base_price_vnd,
        deposit_type, deposit_value, hourly_base_hours, hourly_extra_block_minutes,
        hourly_extra_block_price_vnd, effective_from)
     VALUES ($1, $2, 'Giá theo giờ', 'HOURLY', true, 120000, 'NONE', 0, 2, 60, 40000, $3)`,
    [tenantId, propertyId, effFrom],
  );
  const allResourceIds = [...roomResourceIds, wholeResourceId];
  for (const rid of allResourceIds) {
    await client.query(
      `INSERT INTO rate_plan_resources (tenant_id, rate_plan_id, resource_id) VALUES ($1, $2, $3)`,
      [tenantId, dailyPlan[0]!.id, rid],
    );
  }

  // 4) Khách (PII để NULL — tránh phụ thuộc khoá mã hoá).
  const guestIds: string[] = [];
  for (let i = 0; i < GUEST_NAMES.length; i++) {
    const phone = `09${String(10_000_000 + i * 111_111).slice(0, 8)}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, full_name, phone, nationality) VALUES ($1, $2, $3, 'VN') RETURNING id`,
      [tenantId, GUEST_NAMES[i], phone],
    );
    guestIds.push(rows[0]!.id);
  }

  // 5) Bookings + room_occupancy (chỉ cho booking chưa terminal).
  const bookingIds: string[] = [];
  let bkSeq = 0;
  for (const b of BOOKINGS) {
    bkSeq += 1;
    const code = `BK-${period}-${String(bkSeq).padStart(4, '0')}`;
    const isWhole = b.room === 'WHOLE';
    const resourceId = isWhole ? wholeResourceId : roomResourceIds[b.room as number];
    const nights = b.outOff - b.inOff;
    const total = (isWhole ? NIGHTLY_WHOLE_VND : NIGHTLY_ROOM_VND) * nights;
    const checkIn = vnLocal(anchor, b.inOff, b.inH);
    const checkOut = vnLocal(anchor, b.outOff, b.outH);
    // expires_at: HOLD = +10', PENDING = hạn cọc +2 ngày; còn lại NULL (literal, không param).
    const expires =
      b.status === 'HOLD' ? `now() + interval '10 minutes'`
      : b.status === 'PENDING' ? `now() + interval '2 days'`
      : 'NULL';
    // actual_check_in/out: chỉ có giá trị khi đã nhận/đã trả; còn lại NULL.
    const actualInVal = b.status === 'CHECKED_IN' || b.status === 'CHECKED_OUT' ? checkIn : null;
    const actualOutVal = b.status === 'CHECKED_OUT' ? checkOut : null;

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bookings (tenant_id, property_id, resource_id, guest_id, booking_code, source,
          status, mode, rate_plan_id, check_in, check_out, adults, total_amount_vnd, created_by,
          expires_at, actual_check_in, actual_check_out)
       VALUES ($1, $2, $3, $4, $5, $6, $7::booking_status, 'DAILY', $8,
          $9::timestamp AT TIME ZONE '${TZ}', $10::timestamp AT TIME ZONE '${TZ}',
          2, $11, $12, ${expires},
          $13::timestamp AT TIME ZONE '${TZ}', $14::timestamp AT TIME ZONE '${TZ}')
       RETURNING id`,
      [
        tenantId, propertyId, resourceId, guestIds[b.guest], code, b.source, b.status,
        dailyPlan[0]!.id, checkIn, checkOut, total, userIds.owner, actualInVal, actualOutVal,
      ],
    );
    const bookingId = rows[0]!.id;
    bookingIds.push(bookingId);

    if (NON_TERMINAL.has(b.status)) {
      const rooms = isWhole ? [roomIds[6], roomIds[7]] : [roomIds[b.room as number]];
      for (const roomId of rooms) {
        await client.query(
          `INSERT INTO room_occupancy (tenant_id, room_id, booking_id, period)
           VALUES ($1, $2, $3, tstzrange($4::timestamp AT TIME ZONE '${TZ}', $5::timestamp AT TIME ZONE '${TZ}', '[)'))`,
          [tenantId, roomId, bookingId, checkIn, checkOut],
        );
      }
    }
  }

  // 6) Block bảo trì (203 = idx5), tương lai, không đụng booking phòng đó.
  const { rows: block } = await client.query<{ id: string }>(
    `INSERT INTO room_blocks (tenant_id, room_id, start_at, end_at, reason, created_by)
     VALUES ($1, $2, $3::timestamp AT TIME ZONE '${TZ}', $4::timestamp AT TIME ZONE '${TZ}', 'MAINTENANCE', $5)
     RETURNING id`,
    [tenantId, roomIds[5], vnLocal(anchor, 5, 8), vnLocal(anchor, 7, 18), userIds.owner],
  );
  await client.query(
    `INSERT INTO room_occupancy (tenant_id, room_id, block_id, period)
     VALUES ($1, $2, $3, tstzrange($4::timestamp AT TIME ZONE '${TZ}', $5::timestamp AT TIME ZONE '${TZ}', '[)'))`,
    [tenantId, roomIds[5], block[0]!.id, vnLocal(anchor, 5, 8), vnLocal(anchor, 7, 18)],
  );

  // 7) Hoá đơn + thanh toán (trigger tự tính total/paid/status).
  //    Mỗi phần tử: booking index, kind, nights, status ban đầu, payment (tỉ lệ trả / method) | overdue.
  //    Trả invoiceId + pay tuỳ biến receivedAt/receivedBy (mặc định now()/owner) — bước 11)–20) Đợt 3 dùng.
  //    MONTHLY_RENT (bước 14): truyền `billingPeriod` ('YYYY-MM' — guard idempotent
  //    runMonthlyBilling) + `items` thay item mặc định (display_order 0..n−1; Σ amountVnd
  //    làm cơ sở pay.ratio). Không truyền → hành vi cũ giữ nguyên (1 item mặc định).
  let invSeq = 0;
  async function makeInvoice(opts: {
    bookingIdx: number;
    kind: 'STAY' | 'DEPOSIT' | 'MONTHLY_RENT';
    nights?: number; // chỉ nuôi item mặc định — BỎ QUA khi truyền `items` (mặc định 0)
    nightly?: number;
    status: 'ISSUED' | 'OVERDUE';
    issuedOff: number;
    dueOff: number;
    billingPeriod?: string; // 'YYYY-MM' cho MONTHLY_RENT — ghi invoices.billing_period
    items?: Array<{
      itemType: string;
      description: string;
      quantity: number;
      unitPriceVnd: number;
      amountVnd: number;
    }>;
    pay?: {
      ratio: number;
      method: string;
      receivedAt?: string; // chuỗi local VN 'YYYY-MM-DD HH:mm:ss' (quy ước vnLocal) — mặc định now()
      receivedBy?: string; // user id — mặc định owner
    };
    depositRatioBp?: number; // basis-point cho DEPOSIT
  }): Promise<string> {
    invSeq += 1;
    const number = `INV-${period}-${String(invSeq).padStart(4, '0')}`;
    const nights = opts.nights ?? 0;
    const nightly = opts.nightly ?? 0;
    const baseAmount = nights * nightly;
    const itemAmount = opts.kind === 'DEPOSIT'
      ? Math.round((baseAmount * (opts.depositRatioBp ?? 3000)) / 10000)
      : baseAmount;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO invoices (tenant_id, booking_id, kind, invoice_number, status, issued_at, due_date, billing_period)
       VALUES ($1, $2, $3::invoice_kind, $4, $5::invoice_status,
          now() - ($6 || ' days')::interval, ($7)::date, $8)
       RETURNING id`,
      [tenantId, bookingIds[opts.bookingIdx], opts.kind, number, opts.status,
        String(Math.abs(opts.issuedOff)), ymd(anchor, opts.dueOff), opts.billingPeriod ?? null],
    );
    const invoiceId = rows[0]!.id;
    // items tuỳ biến hoặc 1 item mặc định như cũ (STAY/DEPOSIT) — display_order 0..n−1.
    const items = opts.items ?? [{
      itemType: opts.kind === 'DEPOSIT' ? 'DEPOSIT' : 'ROOM_CHARGE',
      description: opts.kind === 'DEPOSIT' ? 'Đặt cọc 30%' : `Tiền phòng ${nights} đêm`,
      quantity: opts.kind === 'DEPOSIT' ? 1 : nights,
      unitPriceVnd: opts.kind === 'DEPOSIT' ? itemAmount : nightly,
      amountVnd: itemAmount,
    }];
    let order = 0;
    for (const it of items) {
      await client.query(
        `INSERT INTO invoice_items (tenant_id, invoice_id, item_type, description, quantity, unit_price_vnd, amount_vnd, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, invoiceId, it.itemType, it.description, it.quantity, it.unitPriceVnd, it.amountVnd, order],
      );
      order += 1;
    }
    if (opts.pay) {
      // Cơ sở pay.ratio = Σ amount items (items mặc định → đúng bằng itemAmount như cũ).
      const payBase = items.reduce((sum, it) => sum + it.amountVnd, 0);
      const amount = Math.round(payBase * opts.pay.ratio);
      // COALESCE: NULL::timestamp AT TIME ZONE '<TZ>' → NULL → fallback now() (giữ y hệt hành vi cũ).
      await client.query(
        `INSERT INTO payments (tenant_id, invoice_id, amount_vnd, method, status, received_by, received_at)
         VALUES ($1, $2, $3, $4, 'SUCCEEDED', $5, COALESCE($6::timestamp AT TIME ZONE '${TZ}', now()))`,
        [tenantId, invoiceId, amount, opts.pay.method, opts.pay.receivedBy ?? userIds.owner, opts.pay.receivedAt ?? null],
      );
    }
    return invoiceId;
  }

  await makeInvoice({ bookingIdx: 0, kind: 'STAY', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -7, dueOff: -7, pay: { ratio: 1, method: 'CASH' } }); // PAID
  await makeInvoice({ bookingIdx: 2, kind: 'STAY', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -2, dueOff: -2, pay: { ratio: 1, method: 'BANK_TRANSFER' } }); // PAID
  await makeInvoice({ bookingIdx: 3, kind: 'DEPOSIT', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -1, dueOff: 0, pay: { ratio: 1, method: 'VIETQR' }, depositRatioBp: 3000 }); // cọc PAID
  await makeInvoice({ bookingIdx: 5, kind: 'STAY', nights: 2, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: 0, dueOff: 2, pay: { ratio: 0.5, method: 'CASH' } }); // PARTIALLY_PAID
  const overdueInvoiceId = await makeInvoice({ bookingIdx: 1, kind: 'STAY', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'OVERDUE', issuedOff: -5, dueOff: -4 }); // OVERDUE chưa trả — id nuôi metadata noti invoice.overdue (bước 19c)

  // 8) Task dọn phòng (đồng bộ housekeeping_status đã set ở ROOMS).
  //    102 PENDING (DIRTY) · 202 IN_PROGRESS (CLEANING) · 301 COMPLETED (INSPECTION) · 101 VERIFIED (CLEAN)
  await client.query(
    `INSERT INTO cleaning_tasks (tenant_id, property_id, room_id, booking_id, task_type, status, assigned_to, priority, due_at)
     VALUES ($1, $2, $3, $4, 'CHECKOUT_CLEAN', 'PENDING', $5, 1, now() + interval '3 hours')`,
    [tenantId, propertyId, roomIds[1], bookingIds[7], userIds.buongphong],
  );
  await client.query(
    `INSERT INTO cleaning_tasks (tenant_id, property_id, room_id, booking_id, task_type, status, assigned_to, priority, started_at)
     VALUES ($1, $2, $3, $4, 'CHECKOUT_CLEAN', 'IN_PROGRESS', $5, 0, now() - interval '30 minutes')`,
    [tenantId, propertyId, roomIds[4], bookingIds[8], userIds.buongphong],
  );
  await client.query(
    `INSERT INTO cleaning_tasks (tenant_id, property_id, room_id, task_type, status, assigned_to, priority, started_at, completed_at)
     VALUES ($1, $2, $3, 'CHECKOUT_CLEAN', 'COMPLETED', $4, 0, now() - interval '1 day', now() - interval '20 hours')`,
    [tenantId, propertyId, roomIds[6], userIds.buongphong],
  );
  await client.query(
    `INSERT INTO cleaning_tasks (tenant_id, property_id, room_id, task_type, status, assigned_to, verified_by, priority, completed_at, verified_at)
     VALUES ($1, $2, $3, 'DEEP_CLEAN', 'VERIFIED', $4, $5, 0, now() - interval '2 days', now() - interval '2 days')`,
    [tenantId, propertyId, roomIds[0], userIds.buongphong, userIds.owner],
  );

  // 9) Rollup thống kê ngày (30 ngày qua + hôm nay) — cho trang Báo cáo/biểu đồ có số liệu.
  const available = ROOMS.length;
  for (let off = -30; off <= 0; off++) {
    const statDate = ymd(anchor, off);
    const dow = new Date(`${statDate}T00:00:00Z`).getUTCDay(); // 0=CN, 6=T7
    const ratio = dow === 0 || dow === 6 ? 0.85 : 0.55 + ((off + 30) % 5) * 0.05;
    const occupied = Math.max(1, Math.round(available * ratio));
    const adr = NIGHTLY_ROOM_VND + (dow === 0 || dow === 6 ? 150_000 : 0);
    const roomRevenue = occupied * adr;
    await client.query(
      `INSERT INTO daily_property_stats (tenant_id, property_id, stat_date, available_room_nights,
          occupied_room_nights, room_revenue_vnd, other_revenue_vnd, adr_vnd, revpar_vnd)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)`,
      [tenantId, propertyId, statDate, available, occupied, roomRevenue,
        Math.round(roomRevenue * 0.12), adr, Math.round(roomRevenue / available)],
    );
  }

  // 11) Sổ quỹ ca (docs/19 §4 Đợt 3): 2 ca CLOSED hôm qua + 1 ca OPEN hôm nay.
  //     3 payment CASH mới (received_by lễ tân) neo vào cửa sổ ca. Cửa sổ ca inclusive
  //     CẢ 2 đầu (received_at BETWEEN opened_at AND closed_at — shifts.service) nên
  //     KHÔNG đặt payment tại mốc biên 15:00; expected_cash_vnd ca CLOSED phải tự tay
  //     khớp công thức float + Σ(amount − refunded) CASH trong ca (computeExpectedCashInTx),
  //     nếu không trang chi tiết ca sẽ vênh với danh sách payment.
  await makeInvoice({ bookingIdx: 8, kind: 'STAY', nights: 2, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -1, dueOff: 0, pay: { ratio: 1, method: 'CASH', receivedAt: vnLocal(anchor, -1, 9), receivedBy: userIds.letan } }); // 1.400.000 → ca A
  await makeInvoice({ bookingIdx: 7, kind: 'DEPOSIT', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -1, dueOff: 0, pay: { ratio: 1, method: 'CASH', receivedAt: vnLocal(anchor, -1, 11), receivedBy: userIds.letan }, depositRatioBp: 3000 }); // 630.000 → ca A
  await makeInvoice({ bookingIdx: 4, kind: 'STAY', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -1, dueOff: 1, pay: { ratio: 0.5, method: 'CASH', receivedAt: vnLocal(anchor, -1, 18), receivedBy: userIds.letan } }); // 1.050.000 → ca B

  // variance_vnd là GENERATED ALWAYS STORED (counted − expected) → TUYỆT ĐỐI không
  // liệt kê trong column-list. Ca A: float 500k + 1.4M + 630k = expected 2.530.000,
  // đếm 2.380.000 → variance −150.000 (demo lệch quỹ).
  await client.query(
    `INSERT INTO cash_shifts (tenant_id, property_id, opened_by, opened_at, opening_float_vnd,
        closed_by, closed_at, closing_counted_vnd, expected_cash_vnd, status, note)
     VALUES ($1, $2, $3, $4::timestamp AT TIME ZONE '${TZ}', 500000,
        $3, $5::timestamp AT TIME ZONE '${TZ}', 2380000, 2530000, 'CLOSED', 'Ca sáng hôm qua — đếm két thiếu 150.000đ')`,
    [tenantId, propertyId, userIds.letan, vnLocal(anchor, -1, 7), vnLocal(anchor, -1, 15)],
  );
  // Ca B: float 300k + 1.05M = expected 1.350.000 = đếm → variance 0 (khớp quỹ).
  await client.query(
    `INSERT INTO cash_shifts (tenant_id, property_id, opened_by, opened_at, opening_float_vnd,
        closed_by, closed_at, closing_counted_vnd, expected_cash_vnd, status, note)
     VALUES ($1, $2, $3, $4::timestamp AT TIME ZONE '${TZ}', 300000,
        $3, $5::timestamp AT TIME ZONE '${TZ}', 1350000, 1350000, 'CLOSED', 'Ca chiều hôm qua — khớp quỹ')`,
    [tenantId, propertyId, userIds.letan, vnLocal(anchor, -1, 15), vnLocal(anchor, -1, 22)],
  );
  // Ca C — ca OPEN duy nhất (partial unique uq_cash_shift_open_per_property). LEAST
  // giữ opened_at không rơi vào tương lai khi seed chạy 00:00–07:00 VN. 2 payment CASH
  // bước 7 (received_at = now()) rơi vào cửa sổ ca này → chi tiết ca OPEN có dữ liệu.
  await client.query(
    `INSERT INTO cash_shifts (tenant_id, property_id, opened_by, opened_at, opening_float_vnd, status, note)
     VALUES ($1, $2, $3, LEAST(now(), $4::timestamp AT TIME ZONE '${TZ}'), 400000, 'OPEN', 'Ca hôm nay — đang mở')`,
    [tenantId, propertyId, userIds.letan, vnLocal(anchor, 0, 7)],
  );

  // 12) Fixture anti-fraud (docs/19 §4). F1 (idx 17): thu cọc CASH 420k (−3d 10:00)
  //     rồi hủy (−3d 18:00) → báo cáo chống thất thoát ra đúng 1 finding
  //     CANCEL_AFTER_CASH 420.000đ trong cửa sổ [hôm nay−7, hôm nay].
  await makeInvoice({ bookingIdx: 17, kind: 'DEPOSIT', nights: 2, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -3, dueOff: -2, pay: { ratio: 1, method: 'CASH', receivedAt: vnLocal(anchor, -3, 10), receivedBy: userIds.letan }, depositRatioBp: 3000 }); // 420.000 → PAID
  // booking_status_history KHÔNG có DB trigger tự ghi (đã verify 0009 — chỉ app
  // service bookings.service/night-audit ghi) → seed INSERT tay đúng 1 dòng chuyển
  // trạng thái. Nếu sau này thêm trigger ghi history thì GỠ insert này (tránh double).
  const f1Reason = 'Khách hủy đột xuất sau khi đã đóng cọc tiền mặt';
  await client.query(
    `INSERT INTO booking_status_history (tenant_id, booking_id, from_status, to_status, changed_by, reason, created_at)
     VALUES ($1, $2, 'CONFIRMED'::booking_status, 'CANCELLED'::booking_status, $3, $4, $5::timestamp AT TIME ZONE '${TZ}')`,
    [tenantId, bookingIds[17], userIds.letan, f1Reason, vnLocal(anchor, -3, 18)],
  );
  await client.query(
    `UPDATE bookings SET cancelled_at = $3::timestamp AT TIME ZONE '${TZ}', cancelled_by = $4, cancellation_reason = $5
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, bookingIds[17], vnLocal(anchor, -3, 18), userIds.letan, f1Reason],
  );

  // F2 (idx 18): thu CASH 1.4M (−4d 11:00) rồi hoàn TOÀN BỘ (−2d 19:00). CỐ Ý dưới
  // ngưỡng REFUND_ANOMALY_BY_STAFF (1 lần < 3 lần, 1.4M < 2M, chỉ 1 staff → z-score
  // không kích hoạt) → KHÔNG sinh finding nhiễu. Trigger recompute_invoice_paid (0011)
  // tự chuyển invoice PAID → REFUNDED khi payment REFUNDED.
  const f2InvoiceId = await makeInvoice({ bookingIdx: 18, kind: 'STAY', nights: 2, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -6, dueOff: -4, pay: { ratio: 1, method: 'CASH', receivedAt: vnLocal(anchor, -4, 11), receivedBy: userIds.letan } }); // 1.400.000
  await client.query(
    `UPDATE payments SET status = 'REFUNDED', refunded_amount_vnd = amount_vnd,
        refunded_at = $3::timestamp AT TIME ZONE '${TZ}',
        refund_reason = 'Khách khiếu nại chất lượng phòng — hoàn toàn bộ tiền mặt'
     WHERE tenant_id = $1 AND invoice_id = $2`,
    [tenantId, f2InvoiceId, vnLocal(anchor, -2, 19)],
  );

  // 13) Chi phí vận hành + tài sản & khấu hao (P&L / báo cáo tài chính có số liệu).
  //     KHÔNG seed OTA_COMMISSION — đường ghi độc quyền của checkout (0014).
  // Template thuê nhà định kỳ (neo ngày 01 của tháng nay − 2) + 2 child đã sinh:
  // tháng trước (đã trả) và THÁNG NÀY (chưa trả). Child tháng này BẮT BUỘC có
  // expense_date trong tháng hiện tại (ngày 01) — guard của generateRecurringExpenses
  // (night-audit) lọc child theo expense_date trong kỳ → thấy kỳ này đã sinh, không
  // tạo dòng trùng đêm nay.
  const { rows: rentTpl } = await client.query<{ id: string }>(
    `INSERT INTO operational_expenses (tenant_id, property_id, expense_type, description,
        amount_vnd, expense_date, is_recurring, recurrence_pattern, is_paid, paid_at, created_by)
     VALUES ($1, $2, 'RENT_LANDLORD', 'Tiền thuê nhà trả chủ (định kỳ hằng tháng)',
        25000000, $3::date, true, 'MONTHLY', true, ($3::date + 3)::timestamptz, $4)
     RETURNING id`,
    [tenantId, propertyId, firstOfMonth(monthsBack(todayStr, 2)), userIds.owner],
  );
  for (const child of [
    { monthOff: 1, paid: true }, // tháng trước — đã trả
    { monthOff: 0, paid: false }, // tháng NÀY — chưa trả (nằm trong kỳ hiện tại)
  ]) {
    await client.query(
      `INSERT INTO operational_expenses (tenant_id, property_id, expense_type, description,
          amount_vnd, expense_date, is_recurring, parent_expense_id, is_paid, paid_at, created_by)
       VALUES ($1, $2, 'RENT_LANDLORD', 'Tiền thuê nhà trả chủ (sinh từ định kỳ)',
          25000000, $3::date, false, $4, $5, CASE WHEN $5 THEN ($3::date + 3)::timestamptz END, $6)`,
      [tenantId, propertyId, firstOfMonth(monthsBack(todayStr, child.monthOff)), rentTpl[0]!.id, child.paid, userIds.owner],
    );
  }

  // 5 chi phí đơn lẻ trải ~60 ngày — MAINTENANCE gắn phòng 203 (roomIds[5], khớp block bảo trì bước 6).
  const SINGLE_EXPENSES: Array<{
    type: string;
    desc: string;
    amount: number;
    off: number;
    paid: boolean;
    roomIdx?: number;
    createdBy: string;
  }> = [
    { type: 'ELECTRICITY', desc: 'Tiền điện kỳ gần nhất', amount: 4_500_000, off: -20, paid: true, createdBy: userIds.owner },
    { type: 'WATER', desc: 'Tiền nước kỳ gần nhất', amount: 800_000, off: -20, paid: true, createdBy: userIds.owner },
    { type: 'CLEANING_SUPPLIES', desc: 'Vật tư buồng phòng (nước giặt, khăn, amenities)', amount: 650_000, off: -12, paid: true, createdBy: userIds.letan },
    { type: 'MAINTENANCE', desc: 'Sửa điều hòa Phòng 203', amount: 1_200_000, off: -7, paid: false, roomIdx: 5, createdBy: userIds.owner },
    { type: 'MARKETING', desc: 'Chạy quảng cáo fanpage', amount: 2_000_000, off: -45, paid: true, createdBy: userIds.owner },
  ];
  for (const e of SINGLE_EXPENSES) {
    await client.query(
      `INSERT INTO operational_expenses (tenant_id, property_id, room_id, expense_type, description,
          amount_vnd, expense_date, is_paid, paid_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, CASE WHEN $8 THEN ($7::date)::timestamptz END, $9)`,
      [tenantId, propertyId, e.roomIdx == null ? null : roomIds[e.roomIdx], e.type, e.desc, e.amount, ymd(anchor, e.off), e.paid, e.createdBy],
    );
  }

  // Tài sản + sổ khấu hao: kỳ = các tháng ĐỦ liền trước tháng hiện tại (monthsBack —
  // thuần số học); purchase_date = ngày 01 của kỳ sớm nhất; nguyên giá chọn chia hết
  // cho số tháng khấu hao → amount/kỳ tròn (10.8M/36 = 300k · 9M/36 = 250k ·
  // 14.4M/48 = 300k). UNIQUE (asset_id, year, month) an toàn khi re-run vì RESET đã xoá.
  const ASSET_SPECS: Array<{
    name: string;
    category: string;
    roomIdx: number | null;
    value: number;
    months: number;
    periods: number;
  }> = [
    { name: 'Điều hòa Daikin — P.203', category: 'APPLIANCE', roomIdx: 5, value: 10_800_000, months: 36, periods: 4 },
    { name: 'Máy giặt LG — khu chung', category: 'APPLIANCE', roomIdx: null, value: 9_000_000, months: 36, periods: 3 },
    { name: 'Bộ sofa gỗ sảnh', category: 'FURNITURE', roomIdx: null, value: 14_400_000, months: 48, periods: 4 },
  ];
  let depEntryCount = 0;
  for (const a of ASSET_SPECS) {
    const perPeriod = a.value / a.months; // chia hết theo thiết kế trên
    const { rows: assetRows } = await client.query<{ id: string }>(
      `INSERT INTO assets (tenant_id, property_id, room_id, name, category, purchase_value_vnd,
          purchase_date, depreciation_months)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8) RETURNING id`,
      [tenantId, propertyId, a.roomIdx == null ? null : roomIds[a.roomIdx], a.name, a.category,
        a.value, firstOfMonth(monthsBack(todayStr, a.periods)), a.months],
    );
    let accumulated = 0;
    for (let k = a.periods; k >= 1; k--) {
      const p = monthsBack(todayStr, k);
      accumulated += perPeriod;
      await client.query(
        `INSERT INTO depreciation_entries (tenant_id, asset_id, period_year, period_month,
            amount_vnd, accumulated_vnd, book_value_vnd)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, assetRows[0]!.id, p.y, p.m, perPeriod, accumulated, a.value - accumulated],
      );
      depEntryCount += 1;
    }
  }

  // Helper bước 14)–16): booking ĐANG Ở (CHECKED_IN, actual_check_in = check_in,
  // source DIRECT, adults 2, created_by owner) + room_occupancy NON_TERMINAL (pattern
  // bước 5). Cấp số qua bkSeq++ (cùng dãy BK với bước 5 — KHÔNG hardcode thứ tự) và
  // push bookingIds để giữ index liên tục. Bước 5 KHÔNG dùng được helper này vì cần
  // đủ mọi status/expires_at/actual_check_out.
  async function insertCheckedInBooking(opts: {
    resourceId: string;
    occupancyRoomIds: string[]; // các phòng vật lý chiếm chỗ (ROOM = 1 phòng)
    guestId: string;
    ratePlanId: string;
    mode: 'DAILY' | 'MONTHLY';
    checkIn: string; // chuỗi local VN theo quy ước vnLocal
    checkOut: string;
    totalVnd: number;
  }): Promise<string> {
    bkSeq += 1;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bookings (tenant_id, property_id, resource_id, guest_id, booking_code, source,
          status, mode, rate_plan_id, check_in, check_out, adults, total_amount_vnd, created_by, actual_check_in)
       VALUES ($1, $2, $3, $4, $5, 'DIRECT', 'CHECKED_IN'::booking_status, $6::booking_mode, $7,
          $8::timestamp AT TIME ZONE '${TZ}', $9::timestamp AT TIME ZONE '${TZ}',
          2, $10, $11, $8::timestamp AT TIME ZONE '${TZ}')
       RETURNING id`,
      [tenantId, propertyId, opts.resourceId, opts.guestId,
        `BK-${period}-${String(bkSeq).padStart(4, '0')}`, opts.mode, opts.ratePlanId,
        opts.checkIn, opts.checkOut, opts.totalVnd, userIds.owner],
    );
    const bookingId = rows[0]!.id;
    bookingIds.push(bookingId);
    for (const roomId of opts.occupancyRoomIds) {
      await client.query(
        `INSERT INTO room_occupancy (tenant_id, room_id, booking_id, period)
         VALUES ($1, $2, $3, tstzrange($4::timestamp AT TIME ZONE '${TZ}', $5::timestamp AT TIME ZONE '${TZ}', '[)'))`,
        [tenantId, roomId, bookingId, opts.checkIn, opts.checkOut],
      );
    }
    return bookingId;
  }

  // 14) Thuê tháng (docs/19 §4 Đợt 3 — D3c): phòng 401 MỚI tạo inline (KHÔNG thêm vào
  //     const ROOMS — giữ index roomIds/roomResourceIds 0..7 của các bước trên) + rate
  //     plan MONTHLY default (hợp lệ cạnh DAILY/HOURLY vì uq_rate_plan_default theo
  //     (tenant, property, mode)) + 1 booking MONTHLY CHECKED_IN vắt qua hôm nay
  //     [−45d, +45d) + chỉ số điện nước 2 kỳ + hoá đơn MONTHLY_RENT kỳ TRƯỚC đã trả.
  const { rows: room401 } = await client.query<{ id: string }>(
    `INSERT INTO rooms (tenant_id, property_id, room_number, display_name, housekeeping_status, capacity_adults)
     VALUES ($1, $2, '401', 'Phòng 401 — Thuê tháng', 'CLEAN', 2) RETURNING id`,
    [tenantId, propertyId],
  );
  const { rows: res401 } = await client.query<{ id: string }>(
    `INSERT INTO bookable_resources (tenant_id, property_id, type, name)
     VALUES ($1, $2, 'ROOM', 'Phòng 401 — Thuê tháng') RETURNING id`,
    [tenantId, propertyId],
  );
  await client.query(
    `INSERT INTO resource_members (tenant_id, resource_id, room_id) VALUES ($1, $2, $3)`,
    [tenantId, res401[0]!.id, room401[0]!.id],
  );
  const { rows: monthlyPlan } = await client.query<{ id: string }>(
    `INSERT INTO rate_plans (tenant_id, property_id, name, mode, is_default, base_price_vnd,
        deposit_type, deposit_value, monthly_includes_utilities,
        monthly_electricity_per_kwh_vnd, monthly_water_per_m3_vnd, effective_from)
     VALUES ($1, $2, 'Giá thuê tháng', 'MONTHLY', true, $3, 'NONE', 0, false, $4, $5, $6)
     RETURNING id`,
    [tenantId, propertyId, MONTHLY_RENT_VND, ELEC_PER_KWH_VND, WATER_PER_M3_VND, effFrom],
  );
  await client.query(
    `INSERT INTO rate_plan_resources (tenant_id, rate_plan_id, resource_id) VALUES ($1, $2, $3)`,
    [tenantId, monthlyPlan[0]!.id, res401[0]!.id],
  );

  // Booking MONTHLY CHECKED_IN [−45d 14:00, +45d 12:00) — phòng 401 mới toanh nên không
  // thể đụng EXCLUDE room_occupancy. total_amount = 3 tháng thuê (snapshot chốt giá).
  const monthlyBookingId = await insertCheckedInBooking({
    resourceId: res401[0]!.id,
    occupancyRoomIds: [room401[0]!.id],
    guestId: guestIds[11]!,
    ratePlanId: monthlyPlan[0]!.id,
    mode: 'MONTHLY',
    checkIn: vnLocal(anchor, -45, 14),
    checkOut: vnLocal(anchor, 45, 12),
    totalVnd: 3 * MONTHLY_RENT_VND,
  });
  const monthlyIdx = bookingIds.length - 1;

  // Chỉ số điện nước 2 kỳ theo METER (UNIQUE (booking, kỳ) — 2 kỳ KHÁC nhau, recorded_by
  // lễ tân): kỳ TRƯỚC đủ start/end (đầu vào hoá đơn kỳ trước bên dưới); kỳ NÀY mới có
  // chỉ số ĐẦU = end kỳ trước (end NULL — chờ chốt cuối kỳ, UI "ghi chỉ số" có chỗ demo).
  const prevP = monthsBack(todayStr, 1);
  const curP = monthsBack(todayStr, 0);
  await client.query(
    `INSERT INTO monthly_meter_readings (tenant_id, booking_id, period_year, period_month,
        electricity_kwh_start, electricity_kwh_end, water_m3_start, water_m3_end, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [tenantId, monthlyBookingId, prevP.y, prevP.m,
      METER.elecStart, METER.elecEnd, METER.waterStart, METER.waterEnd, userIds.letan],
  );
  await client.query(
    `INSERT INTO monthly_meter_readings (tenant_id, booking_id, period_year, period_month,
        electricity_kwh_start, water_m3_start, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, monthlyBookingId, curP.y, curP.m, METER.elecEnd, METER.waterEnd, userIds.letan],
  );

  // Hoá đơn MONTHLY_RENT kỳ TRƯỚC — như job billing-cycle (night-audit 4.6) đã chạy
  // ngày 01 tháng này: billing_period = 'YYYY-MM' kỳ trước (khớp guard idempotent
  // runMonthlyBilling — gọi lại cho kỳ đó sẽ bỏ qua, không sinh trùng); item format
  // y hệt billing.service (RENT_MONTHLY full tháng + ELECTRICITY/WATER = tiêu thụ
  // (end−start) × đơn giá, làm tròn như roundVnd). Thanh toán đủ BANK_TRANSFER
  // receivedAt=now() (KHÔNG CASH — giữ expected_cash 2 ca CLOSED bước 11) → trigger
  // đưa PAID 7.021.750 (= 6.5M + 125.5×3.5k + 5.5×15k, dẫn xuất từ METER + đơn giá).
  // KHÔNG seed invoice kỳ HIỆN TẠI — để night-audit ngày 01 tháng sau tự sinh.
  const billingPeriod = `${prevP.y}-${String(prevP.m).padStart(2, '0')}`;
  const dayOfMonth = Number(todayStr.slice(8, 10));
  const elecQty = METER.elecEnd - METER.elecStart; // kWh tiêu thụ kỳ trước
  const waterQty = METER.waterEnd - METER.waterStart; // m³ tiêu thụ kỳ trước
  await makeInvoice({
    bookingIdx: monthlyIdx,
    kind: 'MONTHLY_RENT',
    status: 'ISSUED',
    issuedOff: -(dayOfMonth - 1), // phát hành ngày 01 tháng này
    dueOff: 5 - dayOfMonth, // hạn thanh toán ngày 05 tháng này
    billingPeriod,
    items: [
      { itemType: 'RENT_MONTHLY', description: `Tiền thuê tháng ${billingPeriod}`, quantity: 1, unitPriceVnd: MONTHLY_RENT_VND, amountVnd: MONTHLY_RENT_VND },
      { itemType: 'ELECTRICITY', description: `Tiền điện ${elecQty} kWh × ${ELEC_PER_KWH_VND}đ`, quantity: elecQty, unitPriceVnd: ELEC_PER_KWH_VND, amountVnd: Math.round(elecQty * ELEC_PER_KWH_VND) },
      { itemType: 'WATER', description: `Tiền nước ${waterQty} m³ × ${WATER_PER_M3_VND}đ`, quantity: waterQty, unitPriceVnd: WATER_PER_M3_VND, amountVnd: Math.round(waterQty * WATER_PER_M3_VND) },
    ],
    pay: { ratio: 1, method: 'BANK_TRANSFER' },
  });

  // 15) Phụ thu lưu trú (docs/09 §4.3) — gắn booking CHECKED_IN phòng 102 trả phòng
  //     HÔM NAY (bookingIds[7], mới chỉ có DEPOSIT invoice): demo check-out sẽ fold
  //     3 dòng này vào STAY invoice (đủ 3 item_type theo CHECK). KHÔNG sinh
  //     invoice/payment ở đây — không ảnh hưởng sổ quỹ/anti-fraud bước 11)–12).
  const SURCHARGES = [
    { type: 'SURCHARGE', desc: 'Phụ thu thêm 1 khách người lớn', qty: 1, unit: 150_000 },
    { type: 'AMENITY', desc: 'Minibar — bia lon (x2)', qty: 2, unit: 30_000 },
    { type: 'UTILITY', desc: 'Điện lạnh vượt định mức 15 kWh', qty: 15, unit: 3_500 },
  ] as const;
  for (const s of SURCHARGES) {
    await client.query(
      `INSERT INTO booking_surcharges (tenant_id, booking_id, item_type, description,
          quantity, unit_price_vnd, amount_vnd, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, bookingIds[7], s.type, s.desc, s.qty, s.unit, s.qty * s.unit, userIds.letan],
    );
  }

  // 16) Khách NƯỚC NGOÀI + khai báo tạm trú NA17 (docs/12 §2). PASSPORT chỉ ghi last4
  //     — KHÔNG *_enc/*_hash (không phụ thuộc ENCRYPTION_KEY; NA17 export vẫn chạy,
  //     tryDecrypt(null) → ô trống). 2 booking DAILY CHECKED_IN đặt vào cửa sổ TRỐNG
  //     để không vỡ EXCLUDE room_occupancy:
  //     301 (idx6) đã chiếm [+2d 14:00, +5d) + WHOLE [+13d, +16d) → KR [−1d 15:00, +2d 12:00);
  //     302 (idx7) đã chiếm [+8d, +11d) + WHOLE [+13d, +16d) → US [−2d 14:00, +1d 12:00).
  const FOREIGN_GUESTS = [
    { name: 'Kim Ji-woo', nationality: 'KR', phone: '0905551234', last4: '7842' },
    { name: 'Michael Anderson', nationality: 'US', phone: '0905556789', last4: '9310' },
  ] as const;
  const foreignGuestIds: string[] = [];
  for (const g of FOREIGN_GUESTS) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, full_name, phone, nationality, id_document_type, id_document_last4)
       VALUES ($1, $2, $3, $4, 'PASSPORT', $5) RETURNING id`,
      [tenantId, g.name, g.phone, g.nationality, g.last4],
    );
    guestIds.push(rows[0]!.id);
    foreignGuestIds.push(rows[0]!.id);
  }

  const FOREIGN_BOOKINGS = [
    { guest: 0, roomIdx: 6, inOff: -1, inH: 15, outOff: 2, outH: 12 }, // KR — phòng 301
    { guest: 1, roomIdx: 7, inOff: -2, inH: 14, outOff: 1, outH: 12 }, // US — phòng 302
  ] as const;
  const foreignBookingIds: string[] = [];
  for (const fb of FOREIGN_BOOKINGS) {
    const foreignBookingId = await insertCheckedInBooking({
      resourceId: roomResourceIds[fb.roomIdx]!,
      occupancyRoomIds: [roomIds[fb.roomIdx]!],
      guestId: foreignGuestIds[fb.guest]!,
      ratePlanId: dailyPlan[0]!.id,
      mode: 'DAILY',
      checkIn: vnLocal(anchor, fb.inOff, fb.inH),
      checkOut: vnLocal(anchor, fb.outOff, fb.outH),
      totalVnd: NIGHTLY_ROOM_VND * (fb.outOff - fb.inOff),
    });
    foreignBookingIds.push(foreignBookingId);
  }

  // Khai báo NA17 — mỗi khai báo 1 booking RIÊNG (UNIQUE (tenant_id, booking_id));
  // property_id denormalize từ booking. (a) KR DRAFT visa EXEMPT: đủ entry + departure
  // + miễn thị thực → demo bấm "Gửi" (submit) sẽ ra SUBMITTED chứ không FAILED.
  // (b) US SUBMITTED sẵn: visa DL chỉ last4 (enc NULL), kèm mã tiếp nhận XNC.
  await client.query(
    `INSERT INTO foreign_residence_declarations (tenant_id, property_id, booking_id, guest_id,
        visa_type, date_of_entry, port_of_entry, intended_departure, status)
     VALUES ($1, $2, $3, $4, 'EXEMPT', $5::date, 'Sân bay quốc tế Đà Nẵng', $6::date, 'DRAFT')`,
    [tenantId, propertyId, foreignBookingIds[0], foreignGuestIds[0], ymd(anchor, -1), ymd(anchor, 2)],
  );
  await client.query(
    `INSERT INTO foreign_residence_declarations (tenant_id, property_id, booking_id, guest_id,
        visa_type, visa_number_last4, visa_expiry, date_of_entry, port_of_entry, intended_departure,
        status, submitted_at, submitted_by, xnc_reference)
     VALUES ($1, $2, $3, $4, 'DL', '0421', $5::date, $6::date, 'Sân bay quốc tế Tân Sơn Nhất', $7::date,
        'SUBMITTED', $8::timestamp AT TIME ZONE '${TZ}', $9, 'XNC-DEMO-001')`,
    [tenantId, propertyId, foreignBookingIds[1], foreignGuestIds[1],
      ymd(anchor, 30), ymd(anchor, -2), ymd(anchor, 1), vnLocal(anchor, -2, 16), userIds.letan],
  );

  // 17) Mã giảm giá (docs/19 §4 Đợt 3 — D3d): 3 voucher phủ đủ nhánh evaluate
  //     (discounts.service). applicable_property_ids: NULL THẬT = MỌI cơ sở, KHÁC
  //     '{}' (mảng rỗng = KHÔNG cơ sở nào) → SUMMER10/HETHAN ghi NULL literal, GIAM50K
  //     ghi ARRAY[propertyId]::uuid[] đúng 1 phần tử. HETHAN cố ý HẾT HẠN (valid_to
  //     −10d, valid_from −90d thoả CHECK valid_window) nhưng is_active=true → fail
  //     đúng nhánh EXPIRED (không phải INACTIVE) khi demo áp mã vào quote.
  //     PERCENT = basis-point (PERCENT_BP_DIVISOR=10000): 1000 = 10%, 2000 = 20%.
  await client.query(
    `INSERT INTO discount_codes (tenant_id, code, discount_type, discount_value, min_order_vnd,
        max_uses, valid_from, valid_to, applicable_property_ids, is_active)
     VALUES
       ($1, 'SUMMER10', 'PERCENT'::discount_type, 1000, 0, NULL,
          now() - interval '30 days', now() + interval '60 days', NULL, true),
       ($1, 'GIAM50K', 'FIXED'::discount_type, 50000, 500000, 100,
          NULL, NULL, ARRAY[$2]::uuid[], true),
       ($1, 'HETHAN', 'PERCENT'::discount_type, 2000, 0, NULL,
          now() - interval '90 days', now() - interval '10 days', NULL, true)`,
    [tenantId, propertyId],
  );

  // 18) Kênh OTA iCal (docs/19 §4 Đợt 3 — D3d): 2 kênh + 3 mapping + 4 sync job lịch sử.
  //     ical_pull_url = NULL CẢ 3 mapping (cron pull chỉ chọn mapping CÓ URL —
  //     ical-sync.service.syncAllActiveMappings → seed không kích HTTP call nào tới
  //     URL giả); external_listing_url thuần hiển thị. KHÔNG truyền ical_push_token
  //     (DEFAULT gen_random_bytes tự sinh) → demo copy push-URL hoạt động thật.
  const { rows: airbnbCh } = await client.query<{ id: string }>(
    `INSERT INTO channels (tenant_id, property_id, channel_type, display_name, is_active,
        last_synced_at, last_sync_status)
     VALUES ($1, $2, 'AIRBNB_ICAL', 'Airbnb — Cơ sở Mỹ Khê', true,
        now() - interval '1 hour', 'SUCCESS'::sync_job_status)
     RETURNING id`,
    [tenantId, propertyId],
  );
  const { rows: bookingCh } = await client.query<{ id: string }>(
    `INSERT INTO channels (tenant_id, property_id, channel_type, display_name, is_active,
        last_synced_at, last_sync_status)
     VALUES ($1, $2, 'BOOKING_ICAL', 'Booking.com — Cơ sở Mỹ Khê', false,
        now() - interval '2 days', 'FAILED'::sync_job_status)
     RETURNING id`,
    [tenantId, propertyId],
  );

  // Mapping listing↔resource: Airbnb→P.102 (khớp booking source AIRBNB_ICAL sẵn có ở
  // bước 5) + P.201; Booking→P.103. external_listing_id tất định — unique (channel,
  // resource) an toàn nhờ RESET.
  const MAPPINGS = [
    { channelId: airbnbCh[0]!.id, resIdx: 1, listing: 'airbnb-demo-102', url: 'https://www.airbnb.com/rooms/demo-102' },
    { channelId: airbnbCh[0]!.id, resIdx: 3, listing: 'airbnb-demo-201', url: 'https://www.airbnb.com/rooms/demo-201' },
    { channelId: bookingCh[0]!.id, resIdx: 2, listing: 'booking-demo-103', url: 'https://www.booking.com/hotel/vn/demo-103.html' },
  ] as const;
  const mappingIds: string[] = [];
  for (const m of MAPPINGS) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO channel_resource_mappings (tenant_id, channel_id, resource_id,
          external_listing_id, external_listing_url, ical_pull_url)
       VALUES ($1, $2, $3, $4, $5, NULL) RETURNING id`,
      [tenantId, m.channelId, roomResourceIds[m.resIdx]!, m.listing, m.url],
    );
    mappingIds.push(rows[0]!.id);
  }

  // Lịch sử sync 4 job (job_type theo CHECK 0023; status cast ::sync_job_status).
  // PARTIAL conflict_count=1 CHỦ ĐÍCH cho badge cảnh báo xung đột OTA (docs/19 §1.6)
  // — countRecentConflicts cộng conflict_count theo finished_at 7 ngày gần nhất nên
  // finished_at phải SET (job terminal nào cũng có finished_at).
  const SYNC_JOBS = [
    { channelId: airbnbCh[0]!.id, mappingIdx: 1, type: 'PUSH_ICAL', status: 'SUCCESS', ago: '1 hour', processed: 3, created: 0, updated: 0, conflicts: 0, error: null },
    { channelId: airbnbCh[0]!.id, mappingIdx: 0, type: 'PULL_ICAL', status: 'PARTIAL', ago: '1 day', processed: 8, created: 2, updated: 1, conflicts: 1, error: null },
    { channelId: airbnbCh[0]!.id, mappingIdx: 0, type: 'PUSH_ICAL', status: 'SUCCESS', ago: '3 days', processed: 3, created: 0, updated: 0, conflicts: 0, error: null },
    { channelId: bookingCh[0]!.id, mappingIdx: 2, type: 'PULL_ICAL', status: 'FAILED', ago: '2 days', processed: 0, created: 0, updated: 0, conflicts: 0, error: 'HTTP 410 Gone — iCal URL đã bị thu hồi' },
  ] as const;
  for (const j of SYNC_JOBS) {
    await client.query(
      `INSERT INTO sync_jobs (tenant_id, channel_id, channel_mapping_id, job_type, status,
          started_at, finished_at, events_processed, events_created, events_updated,
          conflict_count, error_message)
       VALUES ($1, $2, $3, $4, $5::sync_job_status,
          now() - $6::interval, now() - $6::interval + interval '45 seconds',
          $7, $8, $9, $10, $11)`,
      [tenantId, j.channelId, mappingIds[j.mappingIdx]!, j.type, j.status, j.ago,
        j.processed, j.created, j.updated, j.conflicts, j.error],
    );
  }

  // 19a) Chuyển khoản chưa khớp (đối soát tay — docs/19 §4 Đợt 3): provider CASSO
  //      khớp default scripts/simulate-bank-transfer.ts (M4); transaction_ref tất
  //      định an toàn nhờ RESET (unique (tenant, provider, ref)). GET /payments/
  //      unmatched CHỈ trả PENDING (reconciliation.service.listUnmatched) → dòng
  //      IGNORED chỉ thấy qua SQL/lịch sử — đúng thiết kế. raw mô phỏng payload
  //      webhook; content kiểu nội dung CK không dấu (không chứa mã BK/INV để
  //      không đánh lừa mắt người đối soát).
  const UNMATCHED = [
    { ref: 'DEMO-UM-001', amount: 350_000, content: 'NGUYEN VAN AN CHUYEN TIEN PHONG', agoHours: 24, status: 'PENDING', resolvedBy: null as string | null },
    { ref: 'DEMO-UM-002', amount: 1_250_000, content: 'TRAN THI BINH TT TIEN COC HOMESTAY', agoHours: 48, status: 'PENDING', resolvedBy: null as string | null },
    { ref: 'DEMO-UM-003', amount: 99_000, content: 'LE HOANG CUONG CK NHAM TAI KHOAN', agoHours: 72, status: 'IGNORED', resolvedBy: userIds.owner },
  ] as const;
  for (const u of UNMATCHED) {
    await client.query(
      `INSERT INTO unmatched_payments (tenant_id, provider, transaction_ref, amount_vnd,
          content, bank_account, received_at, status, resolved_by, resolved_payment_id, raw)
       VALUES ($1, 'CASSO', $2, $3, $4, $5, now() - ($6 || ' hours')::interval, $7, $8, NULL, $9::jsonb)`,
      [tenantId, u.ref, u.amount, u.content, DEMO_BANK.account, String(u.agoHours), u.status, u.resolvedBy,
        JSON.stringify({ event_id: u.ref, amount_vnd: u.amount, content: u.content, bank_account: DEMO_BANK.account })],
    );
  }

  // 19b) Thanh toán SaaS (billing M2 — docs/19 §4 Đợt 3): 2 kỳ trước CONFIRMED + kỳ
  //      hiện tại PENDING. SELECT plan PRO ngay tại bước (không hardcode id; amount =
  //      monthly_price_vnd 499k theo seed-prod-required). payment_ref
  //      'PMSSUB-DEMO-YYYYMM' duy nhất TOÀN CỤC (uq_subscription_payments_ref) — an
  //      toàn nhờ RESET + prefix riêng tenant demo, KHÔNG đổi prefix. confirmed_by
  //      NULL khớp confirmPayment thật (subscription.service không set cột này).
  //      created_at tường minh tăng dần theo kỳ → list (ORDER BY created_at DESC) ổn
  //      định. Demo M2: POST /public/billing/mock-gateway/PMSSUB-DEMO-<YYYYMM nay>/pay
  //      confirm được kỳ PENDING (update tenants.current_period_end — hành vi đúng).
  const { rows: proPlans } = await client.query<{ id: string; monthly_price_vnd: string }>(
    `SELECT id, monthly_price_vnd FROM subscription_plans WHERE code = 'PRO'`,
  );
  const proPlan = proPlans[0]!;
  for (const k of [2, 1, 0]) {
    const p = monthsBack(todayStr, k);
    const confirmed = k > 0; // kỳ hiện tại (k=0) PENDING
    await client.query(
      `INSERT INTO subscription_payments (tenant_id, plan_id, plan_code, amount_vnd,
          period_start, period_end, status, payment_ref, confirmed_by, confirmed_at, created_at)
       VALUES ($1, $2, 'PRO', $3,
          $4::timestamp AT TIME ZONE '${TZ}', $5::timestamp AT TIME ZONE '${TZ}',
          $6, $7, NULL,
          CASE WHEN $8 THEN ($4::timestamp + interval '3 days 10 hours') AT TIME ZONE '${TZ}' END,
          ($4::timestamp + interval '8 hours') AT TIME ZONE '${TZ}')`,
      [tenantId, proPlan.id, proPlan.monthly_price_vnd,
        firstOfMonth(p), firstOfMonth(monthsBack(todayStr, k - 1)),
        confirmed ? 'CONFIRMED' : 'PENDING',
        `PMSSUB-DEMO-${p.y}${String(p.m).padStart(2, '0')}`, confirmed],
    );
  }

  // 19c) Thông báo in-app cho OWNER (docs/19 §4 Đợt 3): title/body lấy ĐÚNG map
  //      renderTemplate (notification-targets.ts) để khớp noti thật từ worker;
  //      event_id NULL (tạo tay — partial unique uq_notifications_event chỉ áp
  //      WHERE event_id IS NOT NULL, re-run an toàn nhờ RESET). metadata theo shape
  //      processEvent { event_type, ...payload } → FE điều hướng theo booking_id/
  //      invoice_id. ĐÚNG 2 dòng mới nhất (−2h/−5h) chưa đọc → badge chuông = 2.
  const NOTIFICATIONS = [
    { type: 'booking.created', title: 'Đặt phòng mới', body: 'Có một đặt phòng mới vừa được tạo.', agoHours: 2, read: false, meta: { booking_id: bookingIds[5]! } },
    { type: 'payment.received', title: 'Nhận thanh toán', body: 'Vừa ghi nhận một khoản thanh toán.', agoHours: 5, read: false, meta: { booking_id: bookingIds[0]! } },
    { type: 'invoice.overdue', title: 'Hoá đơn quá hạn', body: 'Một hoá đơn đã quá hạn thanh toán.', agoHours: 24, read: true, meta: { invoice_id: overdueInvoiceId, booking_id: bookingIds[1]! } },
    { type: 'booking.cancelled', title: 'Đặt phòng đã huỷ', body: 'Một đặt phòng vừa bị huỷ.', agoHours: 48, read: true, meta: { booking_id: bookingIds[17]! } },
    { type: 'booking.checked_in', title: 'Khách đã nhận phòng', body: 'Một khách vừa check-in.', agoHours: 72, read: true, meta: { booking_id: bookingIds[3]! } },
  ] as const;
  for (const n of NOTIFICATIONS) {
    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, channel, event_id, title, body,
          metadata, is_read, read_at, created_at)
       VALUES ($1, $2, 'IN_APP', NULL, $3, $4, $5::jsonb, $6,
          CASE WHEN $6 THEN now() - ($7 || ' hours')::interval + interval '30 minutes' END,
          now() - ($7 || ' hours')::interval)`,
      [tenantId, userIds.owner, n.title, n.body,
        JSON.stringify({ event_type: n.type, ...n.meta }), n.read, String(n.agoHours)],
    );
  }

  // CUỐI) Bump document_counters để booking/hoá đơn tạo qua UI không trùng số.
  // GIỮ LÀ BƯỚC CUỐI CÙNG của seedDemoData: mọi bước 11)–20) cấp số BK/INV
  // (BOOKINGS/makeInvoice) phải nằm TRƯỚC khối này — chèn bước seed mới lên trên,
  // nếu không counter < số chứng từ đã seed → UI cấp số trùng (unique violation).
  for (const [type, value] of [['BK', bkSeq], ['INV', invSeq]] as const) {
    await client.query(
      `INSERT INTO document_counters (tenant_id, document_type, period, current_value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, document_type, period)
       DO UPDATE SET current_value = GREATEST(document_counters.current_value, EXCLUDED.current_value)`,
      [tenantId, type, period, value],
    );
  }

  console.log(
    `   Dữ liệu mẫu: ${ROOMS.length + 1} phòng · ${bkSeq} booking · ${invSeq} hoá đơn · 4 task dọn · 31 ngày thống kê · 3 ca quỹ · 8 chi phí · ${ASSET_SPECS.length} tài sản (${depEntryCount} kỳ khấu hao) · 2 chỉ số điện nước · ${SURCHARGES.length} phụ thu · ${FOREIGN_BOOKINGS.length} khai báo NA17 · 3 voucher · 2 kênh iCal (${MAPPINGS.length} mapping, ${SYNC_JOBS.length} sync job) · ${UNMATCHED.length} CK chưa khớp · 3 thanh toán SaaS · ${NOTIFICATIONS.length} thông báo`,
  );
}

async function main(): Promise<void> {
  // Dùng role migrations (postgres superuser) — seed bảng tenant-scoped (RLS) cần bypass
  // RLS; app_user sẽ bị WITH CHECK chặn vì không set app.current_tenant_id. Fallback
  // DATABASE_URL nếu thiếu.
  const url = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu DATABASE_URL_MIGRATIONS/DATABASE_URL (cp .env.example .env)');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: plans } = await client.query<{ id: string }>(
      `SELECT id FROM subscription_plans WHERE code = 'PRO'`,
    );
    const planId = plans[0]?.id;
    if (!planId) throw new Error('Chưa có subscription plan — chạy pnpm db:seed:required trước');

    // 1) Tenant demo (ACTIVE, gói PRO).
    const { rows: tenantRows } = await client.query<{ id: string }>(
      `INSERT INTO tenants (slug, display_name, business_type, status, subscription_plan_id)
       VALUES ($1, 'Demo Homestay Đà Nẵng', 'HOMESTAY', 'ACTIVE', $2)
       ON CONFLICT (slug) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = EXCLUDED.status,
         subscription_plan_id = EXCLUDED.subscription_plan_id
       RETURNING id`,
      [TENANT_SLUG, planId],
    );
    const tenantId = tenantRows[0]!.id;

    // 2) Cơ sở demo (để lễ tân/buồng phòng có phạm vi).
    const existingProp = await client.query<{ id: string }>(
      `SELECT id FROM properties WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [tenantId, PROPERTY_NAME],
    );
    const propertyId =
      existingProp.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          `INSERT INTO properties (tenant_id, name, address_line, province, property_type)
           VALUES ($1, $2, '15 Võ Nguyên Giáp, Mỹ Khê', 'Đà Nẵng', 'HOMESTAY')
           RETURNING id`,
          [tenantId, PROPERTY_NAME],
        )
      ).rows[0]!.id;

    // Tài khoản nhận tiền VietQR (idempotent — cả property mới lẫn đã tồn tại từ seed cũ)
    // → endpoint GET /invoices/:id/qr-image không còn 422 BANK_ACCOUNT_NOT_CONFIGURED.
    await client.query(
      `UPDATE properties SET bank_bin = $2, bank_account_number = $3, bank_account_name = $4 WHERE id = $1`,
      [propertyId, DEMO_BANK.bin, DEMO_BANK.account, DEMO_BANK.name],
    );

    // 20) Rent-to-rent (docs/19 §4 Đợt 3 — D3d): cơ sở demo là nhà THUÊ LẠI của chủ
    // nhà gốc → GET /reports/landlord-statement có dữ liệu. landlord_revenue_share_bp
    // = NULL TƯỜNG MINH: khác NULL thì mô hình REVENUE_SHARE đè FIXED_RENT
    // (reports.service ưu tiên share_bp). monthly_landlord_rent_vnd = 25tr KHỚP
    // expense RENT_LANDLORD 25tr/tháng bước 13 (một nguồn số, demo không lệch).
    // Hợp đồng: ngày 01 của 6 tháng trước, thời hạn 24 tháng (SQL date_trunc theo giờ
    // VN). UPDATE toàn hằng số → idempotent, chạy nhiều lần cùng kết quả. Dữ liệu
    // chủ nhà là demo hư cấu (không phải guest PII — không mã hoá).
    await client.query(
      `UPDATE properties SET
         is_rent_to_rent = true,
         landlord_name = 'Bà Trần Thị Lan',
         landlord_phone = '0905123456',
         monthly_landlord_rent_vnd = 25000000,
         landlord_revenue_share_bp = NULL,
         rent_to_rent_contract_start = (date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '6 months')::date,
         rent_to_rent_contract_end = (date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '6 months' + interval '24 months')::date
       WHERE id = $1`,
      [propertyId],
    );

    // 3) Tài khoản demo theo vai trò (cùng mật khẩu).
    const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
    const userIds = { owner: '', letan: '', buongphong: '' };
    for (const u of DEMO_USERS) {
      const userId = await upsertUser(client, tenantId, u.email, u.fullName, u.role, passwordHash);
      if (u.email === 'owner@demo.vn') userIds.owner = userId;
      if (u.email === 'letan@demo.vn') userIds.letan = userId;
      if (u.email === 'buongphong@demo.vn') userIds.buongphong = userId;
      if (u.scopedToProperty) {
        await client.query(
          `INSERT INTO user_property_roles (tenant_id, user_id, property_id, role)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, property_id, role) DO NOTHING`,
          [tenantId, userId, propertyId, u.role],
        );
      }
    }

    // 4) Dữ liệu mẫu (reset + nạp lại mỗi lần chạy).
    await seedDemoData(client, tenantId, propertyId, userIds);

    console.log('✅ Seed dev xong:');
    console.log(`   Tenant : ${TENANT_SLUG} (Demo Homestay Đà Nẵng, gói PRO)`);
    console.log(`   Cơ sở  : ${PROPERTY_NAME}`);
    console.log(`   Mật khẩu chung: ${DEMO_PASSWORD}`);
    for (const u of DEMO_USERS) console.log(`   - ${u.role.padEnd(11)} ${u.email}`);
    console.log('   ⚠️  Đặt NEXT_PUBLIC_DEFAULT_TENANT_SLUG=demo để login localhost.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Seed dev thất bại:', err);
  process.exit(1);
});
