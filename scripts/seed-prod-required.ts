/**
 * Seed BẮT BUỘC cho mọi môi trường (docs/13 §1): subscription plans + vietnam_holidays.
 * Idempotent — chạy lại bao nhiêu lần cũng được (upsert theo khoá).
 *
 * Chạy: pnpm db:seed:required
 */
import 'dotenv/config';
import { Client } from 'pg';

/**
 * Bộ gói chính thức (chốt 2026-08-11). Hai trần phòng độc lập: `maxRooms` là tổng
 * toàn tài khoản, `maxRoomsPerProperty` là trần của MỘT cơ sở (0036). Giá neo theo
 * số phòng vì phòng là thứ tạo cả giá trị lẫn chi phí vận hành.
 *
 * `priceVnd: 0` ở ENTERPRISE = "liên hệ báo giá" (charge chặn gói giá 0).
 * `features` là cổng bật/tắt tính năng — PlanFeatureGuard đọc trực tiếp cột này,
 * và bảng giá công khai render tick từ đúng cột này. Vì vậy CHỈ bật cờ của tính
 * năng đã giao được: `zns` (provider zalo chưa cấu hình) và `api_access` (chưa có
 * API công khai) cố ý để tắt cho tới khi chạy thật.
 */
const PLANS = [
  {
    code: 'FREE',
    name: 'Miễn phí',
    maxProperties: 1,
    maxRoomsPerProperty: 5,
    maxRooms: 5,
    maxUsers: 2,
    priceVnd: 0,
    features: {},
  },
  {
    code: 'STARTER',
    name: 'Khởi nghiệp',
    maxProperties: 1,
    maxRoomsPerProperty: 15,
    maxRooms: 15,
    maxUsers: 3,
    priceVnd: 299_000,
    features: { ota_sync: true, vietqr: true, invoices: true, compliance: true, cleaning: true },
  },
  {
    code: 'PRO',
    name: 'Chuyên nghiệp',
    maxProperties: 3,
    maxRoomsPerProperty: 25,
    maxRooms: 75,
    maxUsers: 10,
    priceVnd: 799_000,
    features: {
      ota_sync: true,
      vietqr: true,
      invoices: true,
      compliance: true,
      cleaning: true,
      multi_property_reports: true,
      assets: true,
      shifts: true,
    },
  },
  {
    code: 'ENTERPRISE',
    name: 'Doanh nghiệp',
    maxProperties: 20,
    maxRoomsPerProperty: 100,
    maxRooms: 2000,
    maxUsers: 50,
    priceVnd: 0,
    features: {
      ota_sync: true,
      vietqr: true,
      invoices: true,
      compliance: true,
      cleaning: true,
      multi_property_reports: true,
      assets: true,
      shifts: true,
    },
  },
] as const;

/**
 * Lịch lễ VN (docs/07 §4) — NGUỒN DUY NHẤT cho pricing rule HOLIDAY.
 * ⚠️ Ngày ÂM LỊCH (Tết, Giỗ Tổ) + ngày nghỉ bù là BASELINE — PHẢI đối chiếu
 * thông báo nghỉ lễ chính thức của Chính phủ hằng năm (task: alert tháng 11 nếu
 * năm sau chưa có data). Ngày dương lịch cố định (1/1, 30/4, 1/5, 2/9) là chắc chắn.
 */
const HOLIDAYS: { date: string; name: string; substitute?: boolean }[] = [
  // 2026 — Tết Bính Ngọ (mùng 1 = 17/02/2026)
  { date: '2026-01-01', name: 'Tết Dương lịch' },
  { date: '2026-02-16', name: 'Giao thừa (30 Tết)' },
  { date: '2026-02-17', name: 'Mùng 1 Tết Bính Ngọ' },
  { date: '2026-02-18', name: 'Mùng 2 Tết' },
  { date: '2026-02-19', name: 'Mùng 3 Tết' },
  { date: '2026-02-20', name: 'Mùng 4 Tết' },
  { date: '2026-02-21', name: 'Mùng 5 Tết' },
  { date: '2026-04-26', name: 'Giỗ Tổ Hùng Vương (10/3 ÂL)' },
  { date: '2026-04-30', name: 'Ngày Giải phóng miền Nam' },
  { date: '2026-05-01', name: 'Quốc tế Lao động' },
  { date: '2026-09-01', name: 'Nghỉ lễ Quốc khánh (ngày liền kề)', substitute: true },
  { date: '2026-09-02', name: 'Quốc khánh' },
  // 2027 — Tết Đinh Mùi (mùng 1 = 06/02/2027)
  { date: '2027-01-01', name: 'Tết Dương lịch' },
  { date: '2027-02-05', name: 'Giao thừa (30 Tết)' },
  { date: '2027-02-06', name: 'Mùng 1 Tết Đinh Mùi' },
  { date: '2027-02-07', name: 'Mùng 2 Tết' },
  { date: '2027-02-08', name: 'Mùng 3 Tết' },
  { date: '2027-02-09', name: 'Mùng 4 Tết' },
  { date: '2027-02-10', name: 'Mùng 5 Tết' },
  { date: '2027-04-15', name: 'Giỗ Tổ Hùng Vương (10/3 ÂL)' },
  { date: '2027-04-30', name: 'Ngày Giải phóng miền Nam' },
  { date: '2027-05-01', name: 'Quốc tế Lao động' },
  { date: '2027-09-01', name: 'Nghỉ lễ Quốc khánh (ngày liền kề)', substitute: true },
  { date: '2027-09-02', name: 'Quốc khánh' },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu DATABASE_URL (cp .env.example .env)');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const plan of PLANS) {
      await client.query(
        `INSERT INTO subscription_plans
           (code, name, max_properties, max_rooms, max_rooms_per_property, max_users, monthly_price_vnd, features)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           max_properties = EXCLUDED.max_properties,
           max_rooms = EXCLUDED.max_rooms,
           max_rooms_per_property = EXCLUDED.max_rooms_per_property,
           max_users = EXCLUDED.max_users,
           monthly_price_vnd = EXCLUDED.monthly_price_vnd,
           features = EXCLUDED.features`,
        [
          plan.code,
          plan.name,
          plan.maxProperties,
          plan.maxRooms,
          plan.maxRoomsPerProperty,
          plan.maxUsers,
          plan.priceVnd,
          JSON.stringify(plan.features),
        ],
      );
    }
    const { rows } = await client.query('SELECT code FROM subscription_plans ORDER BY code');
    console.log(`✅ Seed plans xong: ${rows.map((r: { code: string }) => r.code).join(', ')}`);

    for (const h of HOLIDAYS) {
      await client.query(
        `INSERT INTO vietnam_holidays (holiday_date, name, is_substitute, source)
         VALUES ($1, $2, $3, 'baseline-2026-2027 (cần xác nhận thông báo nghỉ lễ chính thức)')
         ON CONFLICT (holiday_date) DO UPDATE SET
           name = EXCLUDED.name,
           is_substitute = EXCLUDED.is_substitute,
           source = EXCLUDED.source`,
        [h.date, h.name, h.substitute ?? false],
      );
    }
    const { rows: hrows } = await client.query('SELECT count(*)::int AS n FROM vietnam_holidays');
    console.log(`✅ Seed vietnam_holidays xong: ${hrows[0].n} ngày (2026–2027)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Seed plans thất bại:', err);
  process.exit(1);
});
