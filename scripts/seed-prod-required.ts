/**
 * Seed BẮT BUỘC cho mọi môi trường (docs/13 §1): subscription plans.
 * (vietnam_holidays seed thêm ở task 2.2 khi bảng được tạo.)
 * Idempotent — chạy lại bao nhiêu lần cũng được (upsert theo code).
 *
 * Chạy: pnpm db:seed:required
 */
import 'dotenv/config';
import { Client } from 'pg';

// TODO(task 4.7 billing-lite): chốt hạn mức + giá chính thức với product
const PLANS = [
  { code: 'FREE', name: 'Miễn phí', maxProperties: 1, maxRooms: 5, maxUsers: 2, priceVnd: 0 },
  { code: 'STARTER', name: 'Khởi nghiệp', maxProperties: 2, maxRooms: 20, maxUsers: 5, priceVnd: 199_000 },
  { code: 'PRO', name: 'Chuyên nghiệp', maxProperties: 5, maxRooms: 100, maxUsers: 15, priceVnd: 499_000 },
  { code: 'ENTERPRISE', name: 'Doanh nghiệp', maxProperties: 99, maxRooms: 1000, maxUsers: 99, priceVnd: 0 },
] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu DATABASE_URL (cp .env.example .env)');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const plan of PLANS) {
      await client.query(
        `INSERT INTO subscription_plans (code, name, max_properties, max_rooms, max_users, monthly_price_vnd)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           max_properties = EXCLUDED.max_properties,
           max_rooms = EXCLUDED.max_rooms,
           max_users = EXCLUDED.max_users,
           monthly_price_vnd = EXCLUDED.monthly_price_vnd`,
        [plan.code, plan.name, plan.maxProperties, plan.maxRooms, plan.maxUsers, plan.priceVnd],
      );
    }
    const { rows } = await client.query('SELECT code FROM subscription_plans ORDER BY code');
    console.log(`✅ Seed plans xong: ${rows.map((r: { code: string }) => r.code).join(', ')}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Seed plans thất bại:', err);
  process.exit(1);
});
