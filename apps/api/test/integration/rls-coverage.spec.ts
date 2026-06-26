import 'reflect-metadata';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ★ Guard CI: MỌI bảng tenant-scoped phải bật RLS (docs/18 P2-D1, docs/02 §12).
 *
 * Rủi ro lớn nhất của mô hình shared-schema + RLS là **quên bật RLS khi thêm
 * bảng mới** → rò rỉ chéo tenant ÂM THẦM. ESLint chặn `this.prisma.<model>` nhưng
 * KHÔNG kiểm được trạng thái RLS ở DB. Test này quét catalog Postgres:
 *
 *   Mọi bảng (public, không phải partition con) có cột `tenant_id` PHẢI có
 *   ENABLE + FORCE ROW LEVEL SECURITY + ≥1 policy — TRỪ allowlist cross-tenant.
 *
 * Đọc catalog (không grep migration) nên bắt được cả RLS "thủ công" như
 * audit_logs (policy append-only SELECT+INSERT, không qua enforce_tenant_isolation).
 *
 * Thêm bảng tenant-scoped mà quên RLS → test ĐỎ. Bảng cross-tenant cố ý → phải
 * thêm vào ALLOWLIST kèm lý do (ép quyết định tường minh).
 */

/**
 * Bảng có cột `tenant_id` nhưng CỐ Ý không bật RLS (truy cập cross-tenant theo
 * thiết kế, trước khi resolve được tenant). Mỗi mục bắt buộc có lý do + migration.
 */
const NO_RLS_ALLOWLIST: Record<string, string> = {
  // 0017: dispatcher claim CROSS-TENANT (FOR UPDATE SKIP LOCKED) — không có tenant
  // context lúc fan-out; tenant_id chỉ để định tuyến event.
  outbox_events: '0017 — outbox dispatcher claim cross-tenant',
  // 0012: dedup webhook theo PK (source,event_id) TRƯỚC khi resolve tenant từ TK
  // nhận → tenant_id nullable, set sau.
  webhook_events_received: '0012 — dedup webhook trước khi resolve tenant',
  // 0021: billing nền tảng; platform admin xác nhận thanh toán cross-tenant (no
  // tenant GUC). Bảng GLOBAL no-RLS + FK CASCADE.
  subscription_payments: '0021 — SaaS billing nền tảng, platform admin cross-tenant',
};

interface TableRlsRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: number;
}

describe('RLS coverage guard (docs/18 P2-D1)', () => {
  let admin: Client;
  let rows: TableRlsRow[];

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    const res = await admin.query<TableRlsRow>(`
      SELECT c.relname                                                          AS table_name,
             c.relrowsecurity                                                   AS rls_enabled,
             c.relforcerowsecurity                                              AS rls_forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int   AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')      -- bảng thường + bảng partition cha
        AND c.relispartition = false      -- bỏ qua partition con (policy ở cha)
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
            AND a.attnum > 0 AND NOT a.attisdropped
        )
      ORDER BY c.relname
    `);
    rows = res.rows;
  });

  afterAll(async () => {
    await admin?.end();
  });

  it('có quét được ≥1 bảng tenant-scoped (catalog sống, không rỗng)', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('MỌI bảng có tenant_id (ngoài allowlist) đều ENABLE+FORCE RLS + ≥1 policy', () => {
    const violations = rows
      .filter((r) => !(r.table_name in NO_RLS_ALLOWLIST))
      .filter((r) => !(r.rls_enabled && r.rls_forced && r.policy_count > 0))
      .map(
        (r) =>
          `  - ${r.table_name}: enable=${r.rls_enabled} force=${r.rls_forced} policies=${r.policy_count}`,
      );

    expect(
      violations,
      violations.length === 0
        ? ''
        : `Bảng tenant-scoped thiếu RLS (rò rỉ chéo tenant!). Sửa: thêm ` +
            `enforce_tenant_isolation('<table>') trong migration; nếu CỐ Ý cross-tenant → ` +
            `thêm vào NO_RLS_ALLOWLIST kèm lý do.\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('allowlist không có mục cũ (mọi bảng allowlist còn tồn tại)', () => {
    const present = new Set(rows.map((r) => r.table_name));
    const stale = Object.keys(NO_RLS_ALLOWLIST).filter((t) => !present.has(t));
    expect(stale, `Allowlist trỏ tới bảng không còn cột tenant_id / không tồn tại: ${stale.join(', ')}`).toEqual([]);
  });
});
