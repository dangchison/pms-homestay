import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 4.5 (docs/03 §audit_logs):
 *  - audit_logs partition theo tháng + RLS + APPEND-ONLY (chỉ INSERT/SELECT).
 *  - AuditInterceptor tự ghi POST/PATCH/DELETE (CREATE/UPDATE/STATE_CHANGE/DELETE)
 *    với redact PII trong after_data.
 *  - action READ_PII từ path giải mã số giấy tờ (guests.service).
 *  - GET /audit-logs filter + quyền audit_log.read (OWNER/ACCOUNTANT; STAFF → 403).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `audit-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const staffEmail = `staff-${RUN}@e2e.test`;

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: unknown;
  after_data: Record<string, unknown> | null;
  ip_address: string | null;
  request_id: string | null;
  created_at: string;
}

describe('Audit log (task 4.5)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let appUser: Client;
  let ownerToken: string;
  let staffToken: string;
  let tenantId: string;
  let ownerId: string;
  let propertyId: string;
  let guestId: string;

  const ownerAuth = () => ({ Authorization: `Bearer ${ownerToken}` });

  const auditList = async (qs: string): Promise<AuditRow[]> =>
    (await request(http).get(`/api/v1/audit-logs?${qs}`).set(ownerAuth()).expect(200)).body.data;

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();

    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    appUser = new Client({ connectionString: process.env.DATABASE_URL });
    await appUser.connect();

    await request(http)
      .post('/api/v1/auth/register')
      .send({
        tenant_slug: tenantSlug,
        tenant_display_name: 'AUDIT E2E',
        email: ownerEmail,
        password: PASSWORD,
        full_name: 'Owner',
      })
      .expect(201);

    const t = await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug]);
    tenantId = t.rows[0].id;
    const o = await admin.query(`SELECT id FROM users WHERE tenant_id = $1 AND email = $2`, [
      tenantId,
      ownerEmail,
    ]);
    ownerId = o.rows[0].id;

    ownerToken = (
      await request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email: ownerEmail, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;

    propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(ownerAuth())
        .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;

    // STAFF (không có audit_log.read) — seed trực tiếp DB như rbac.e2e (chưa có user.invite).
    const staffHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const staff = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role)
       VALUES ($1, $2, $3, 'Staff', 'STAFF') RETURNING id`,
      [tenantId, staffEmail, staffHash],
    );
    await admin.query(
      `INSERT INTO user_property_roles (tenant_id, user_id, property_id, role)
       VALUES ($1, $2, $3, 'STAFF')`,
      [tenantId, staff.rows[0].id, propertyId],
    );
    staffToken = (
      await request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email: staffEmail, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      // KHÔNG xoá audit_logs ở đây: FK tenant_id ON DELETE CASCADE phải dọn cùng
      // tenant (xác minh ngầm cascade hoạt động — nền cho 21 e2e khác không tự dọn).
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await appUser?.end();
    await app?.close();
  });

  it('migration: audit_logs là bảng partitioned theo tháng + có partition con', async () => {
    const kind = await admin.query(`SELECT relkind FROM pg_class WHERE relname = 'audit_logs'`);
    expect(kind.rows[0].relkind).toBe('p'); // 'p' = partitioned table
    const parts = await admin.query(
      `SELECT count(*)::int AS n FROM pg_inherits WHERE inhparent = 'audit_logs'::regclass`,
    );
    expect(parts.rows[0].n).toBeGreaterThan(0);
  });

  it('auto-log CREATE + redact PII: POST /guests ghi 1 dòng (id_document_number → [REDACTED])', async () => {
    guestId = (
      await request(http)
        .post('/api/v1/guests')
        .set(ownerAuth())
        .send({ full_name: 'Nguyễn Văn A', phone: '0900000001', id_document_type: 'CCCD', id_document_number: '012345678901' })
        .expect(201)
    ).body.data.id;

    const rows = await auditList(`entity_type=guests&action=CREATE&entity_id=${guestId}`);
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.action).toBe('CREATE');
    expect(row.entity_type).toBe('guests');
    expect(row.entity_id).toBe(guestId);
    expect(row.user_id).toBe(ownerId);
    expect(row.request_id).toBeTruthy();
    // redact: số giấy tờ KHÔNG được lưu plaintext; tên thường vẫn còn.
    expect(row.after_data?.id_document_number).toBe('[REDACTED]');
    expect(row.after_data?.full_name).toBe('Nguyễn Văn A');
  });

  it('action READ_PII: GET /guests/:id/id-document ghi audit READ_PII (không lưu số)', async () => {
    await request(http).get(`/api/v1/guests/${guestId}/id-document`).set(ownerAuth()).expect(200);

    const rows = await auditList(`action=READ_PII&entity_id=${guestId}`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.entity_type).toBe('guests');
    expect(rows[0]!.user_id).toBe(ownerId);
    expect(rows[0]!.after_data).toEqual({ field: 'id_document_number' });
  });

  it('auto-log UPDATE: PATCH /guests/:id ghi action UPDATE', async () => {
    await request(http)
      .patch(`/api/v1/guests/${guestId}`)
      .set(ownerAuth())
      .send({ full_name: 'Nguyễn Văn B' })
      .expect(200);

    const rows = await auditList(`action=UPDATE&entity_id=${guestId}`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.action).toBe('UPDATE');
    expect(rows[0]!.after_data?.full_name).toBe('Nguyễn Văn B');
  });

  it('auto-log STATE_CHANGE: POST /guests/:id/blacklist (POST /:id/verb) ghi STATE_CHANGE', async () => {
    await request(http)
      .post(`/api/v1/guests/${guestId}/blacklist`)
      .set(ownerAuth())
      .send({ reason: 'gian lận' })
      .expect(201);

    const rows = await auditList(`action=STATE_CHANGE&entity_id=${guestId}`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.entity_type).toBe('guests');
  });

  it('GET /audit-logs: filter entity_id trả mọi action của guest + page_info', async () => {
    const res = await request(http)
      .get(`/api/v1/audit-logs?entity_id=${guestId}&page=1&page_size=20`)
      .set(ownerAuth())
      .expect(200);
    const actions = (res.body.data as AuditRow[]).map((r) => r.action).sort();
    expect(actions).toEqual(['CREATE', 'READ_PII', 'STATE_CHANGE', 'UPDATE']);
    // DESC theo thời gian: dòng đầu là action mới nhất (STATE_CHANGE).
    expect((res.body.data as AuditRow[])[0]!.action).toBe('STATE_CHANGE');
    expect(res.body.page_info.total_items).toBe(4);
    expect(res.body.page_info.page).toBe(1);
  });

  it('quyền: STAFF (không có audit_log.read) → 403; OWNER → 200', async () => {
    await request(http)
      .get('/api/v1/audit-logs')
      .set({ Authorization: `Bearer ${staffToken}` })
      .expect(403);
    await request(http).get('/api/v1/audit-logs').set(ownerAuth()).expect(200);
  });

  it('append-only: app_user KHÔNG UPDATE/DELETE được audit_logs (RLS chỉ SELECT/INSERT)', async () => {
    await appUser.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantId]);
    const seen = await appUser.query(`SELECT count(*)::int AS n FROM audit_logs`);
    expect(seen.rows[0].n).toBeGreaterThan(0); // SELECT thấy dòng của tenant

    const upd = await appUser.query(`UPDATE audit_logs SET action = 'DELETE' WHERE tenant_id = $1`, [
      tenantId,
    ]);
    expect(upd.rowCount).toBe(0); // không policy UPDATE → 0 dòng (FORCE RLS)
    const del = await appUser.query(`DELETE FROM audit_logs WHERE tenant_id = $1`, [tenantId]);
    expect(del.rowCount).toBe(0); // không policy DELETE → 0 dòng

    const still = await appUser.query(`SELECT count(*)::int AS n FROM audit_logs`);
    expect(still.rows[0].n).toBe(seen.rows[0].n); // dữ liệu nguyên vẹn
  });
});
