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
  status: 'HOLD' | 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT';
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
  let invSeq = 0;
  async function makeInvoice(opts: {
    bookingIdx: number;
    kind: 'STAY' | 'DEPOSIT';
    nights: number;
    nightly: number;
    status: 'ISSUED' | 'OVERDUE';
    issuedOff: number;
    dueOff: number;
    pay?: { ratio: number; method: string };
    depositRatioBp?: number; // basis-point cho DEPOSIT
  }): Promise<void> {
    invSeq += 1;
    const number = `INV-${period}-${String(invSeq).padStart(4, '0')}`;
    const baseAmount = opts.nights * opts.nightly;
    const itemAmount = opts.kind === 'DEPOSIT'
      ? Math.round((baseAmount * (opts.depositRatioBp ?? 3000)) / 10000)
      : baseAmount;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO invoices (tenant_id, booking_id, kind, invoice_number, status, issued_at, due_date)
       VALUES ($1, $2, $3::invoice_kind, $4, $5::invoice_status,
          now() - ($6 || ' days')::interval, ($7)::date)
       RETURNING id`,
      [tenantId, bookingIds[opts.bookingIdx], opts.kind, number, opts.status,
        String(Math.abs(opts.issuedOff)), ymd(anchor, opts.dueOff)],
    );
    const invoiceId = rows[0]!.id;
    await client.query(
      `INSERT INTO invoice_items (tenant_id, invoice_id, item_type, description, quantity, unit_price_vnd, amount_vnd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId, invoiceId,
        opts.kind === 'DEPOSIT' ? 'DEPOSIT' : 'ROOM_CHARGE',
        opts.kind === 'DEPOSIT' ? 'Đặt cọc 30%' : `Tiền phòng ${opts.nights} đêm`,
        opts.kind === 'DEPOSIT' ? 1 : opts.nights,
        opts.kind === 'DEPOSIT' ? itemAmount : opts.nightly,
        itemAmount,
      ],
    );
    if (opts.pay) {
      const amount = Math.round(itemAmount * opts.pay.ratio);
      await client.query(
        `INSERT INTO payments (tenant_id, invoice_id, amount_vnd, method, status, received_by, received_at)
         VALUES ($1, $2, $3, $4, 'SUCCEEDED', $5, now())`,
        [tenantId, invoiceId, amount, opts.pay.method, userIds.owner],
      );
    }
  }

  await makeInvoice({ bookingIdx: 0, kind: 'STAY', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -7, dueOff: -7, pay: { ratio: 1, method: 'CASH' } }); // PAID
  await makeInvoice({ bookingIdx: 2, kind: 'STAY', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -2, dueOff: -2, pay: { ratio: 1, method: 'BANK_TRANSFER' } }); // PAID
  await makeInvoice({ bookingIdx: 3, kind: 'DEPOSIT', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: -1, dueOff: 0, pay: { ratio: 1, method: 'VIETQR' }, depositRatioBp: 3000 }); // cọc PAID
  await makeInvoice({ bookingIdx: 5, kind: 'STAY', nights: 2, nightly: NIGHTLY_ROOM_VND, status: 'ISSUED', issuedOff: 0, dueOff: 2, pay: { ratio: 0.5, method: 'CASH' } }); // PARTIALLY_PAID
  await makeInvoice({ bookingIdx: 1, kind: 'STAY', nights: 3, nightly: NIGHTLY_ROOM_VND, status: 'OVERDUE', issuedOff: -5, dueOff: -4 }); // OVERDUE chưa trả

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

  // 10) Bump document_counters để booking/hoá đơn tạo qua UI không trùng số.
  for (const [type, value] of [['BK', bkSeq], ['INV', invSeq]] as const) {
    await client.query(
      `INSERT INTO document_counters (tenant_id, document_type, period, current_value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, document_type, period)
       DO UPDATE SET current_value = GREATEST(document_counters.current_value, EXCLUDED.current_value)`,
      [tenantId, type, period, value],
    );
  }

  console.log(`   Dữ liệu mẫu: ${ROOMS.length} phòng · ${BOOKINGS.length} booking · ${invSeq} hoá đơn · 4 task dọn · 31 ngày thống kê`);
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
