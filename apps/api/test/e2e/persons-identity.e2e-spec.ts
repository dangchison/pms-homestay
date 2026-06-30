import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance TASK 9.2 (docs/16): tầng danh tính khách TOÀN CỤC (`persons`).
 * Cùng số giấy tờ ⇒ cùng person xuyên tenant; CHỈ nhận diện (is_returning /
 * blacklisted_elsewhere) — KHÔNG lộ PII cross-tenant (chủ B không thấy dữ liệu chủ
 * A). Verify cross-tenant bằng admin client (DATABASE_URL_MIGRATIONS bypass RLS),
 * KHÔNG qua API (API không có đường đọc cross-tenant).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const slugA = `pid-a-${RUN}`;
const slugB = `pid-b-${RUN}`;
const ownerA = `owner-a-${RUN}@e2e.test`;
const ownerB = `owner-b-${RUN}@e2e.test`;
const DOC_X = `IDX${RUN}`; // số giấy tờ chung (cùng một người)
const DOC_Y = `IDY${RUN}`; // số giấy tờ mới (test re-link)
const DOC_Z = `IDZ${RUN}`; // số giấy tờ cho guest test erase

describe('Global person identity (docs/16 — tầng persons)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let tokenA: string;
  let tokenB: string;
  let guestA: string;
  let guestB: string;
  const touchedPersons = new Set<string>();

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const createGuest = (token: string, body: Record<string, unknown>) =>
    request(http).post('/api/v1/guests').set(auth(token)).send(body);
  const summary = (token: string, id: string) =>
    request(http).get(`/api/v1/guests/${id}/platform-summary`).set(auth(token));

  const guestPersonId = async (id: string): Promise<string | null> =>
    (await admin.query(`SELECT person_id FROM guests WHERE id = $1`, [id])).rows[0]?.person_id ?? null;
  const personRow = async (personId: string): Promise<{ tenant_link_count: number; blacklisted_anywhere: boolean }> =>
    (await admin.query(`SELECT tenant_link_count, blacklisted_anywhere FROM persons WHERE id = $1`, [personId]))
      .rows[0];
  const track = (pid: string | null): string => {
    if (pid) touchedPersons.add(pid);
    return pid as string;
  };

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    const register = (slug: string, email: string, name: string) =>
      request(http)
        .post('/api/v1/auth/register')
        .send({ tenant_slug: slug, tenant_display_name: name, email, password: PASSWORD, full_name: 'Owner' })
        .expect(201);
    await register(slugA, ownerA, 'PID A');
    await register(slugB, ownerB, 'PID B');
    const login = (slug: string, email: string) =>
      request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slug).send({ email, password: PASSWORD }).expect(200);
    tokenA = (await login(slugA, ownerA)).body.data.access_token;
    tokenB = (await login(slugB, ownerB)).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tids = `(SELECT id FROM tenants WHERE slug IN ('${slugA}','${slugB}'))`;
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tids}`);
      if (touchedPersons.size > 0) {
        await admin.query(`DELETE FROM persons WHERE id = ANY($1::uuid[])`, [[...touchedPersons]]);
      }
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tids}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tids}`);
      await admin.query(`DELETE FROM tenants WHERE slug IN ('${slugA}','${slugB}')`);
      await admin.end();
    }
    await app?.close();
  });

  it('★ khách mới có giấy tờ → tạo person, tenant_link_count=1', async () => {
    guestA = (
      await createGuest(tokenA, { full_name: 'Nguyễn Văn A', id_document_type: 'CCCD', id_document_number: DOC_X }).expect(201)
    ).body.data.id;
    const pid = track(await guestPersonId(guestA));
    expect(pid).toBeTruthy();
    expect((await personRow(pid)).tenant_link_count).toBe(1);
  });

  it('★ cùng giấy tờ ở tenant B → link CÙNG person, tenant_link_count=2', async () => {
    guestB = (
      await createGuest(tokenB, { full_name: 'Tên khác do B nhập', id_document_type: 'CCCD', id_document_number: DOC_X }).expect(201)
    ).body.data.id;
    const pidA = await guestPersonId(guestA);
    const pidB = track(await guestPersonId(guestB));
    expect(pidB).toBe(pidA); // cùng một người xuyên tenant
    expect((await personRow(pidA!)).tenant_link_count).toBe(2);
  });

  it('★ B thấy is_returning_guest nhưng KHÔNG lộ PII của A', async () => {
    const body = (await summary(tokenB, guestB).expect(200)).body.data;
    expect(body).toEqual({ linked: true, is_returning_guest: true, blacklisted_elsewhere: false });
    // chỉ đúng 3 cờ boolean — không tên/SĐT/booking/tenant của A
    expect(Object.keys(body).sort()).toEqual(['blacklisted_elsewhere', 'is_returning_guest', 'linked']);
    expect(JSON.stringify(body)).not.toContain('Nguyễn Văn A');
  });

  it('khách KHÔNG giấy tờ → person_id null, linked=false', async () => {
    const id = (await createGuest(tokenA, { full_name: 'Khách vãng lai' }).expect(201)).body.data.id;
    expect(await guestPersonId(id)).toBeNull();
    expect((await summary(tokenA, id).expect(200)).body.data).toEqual({
      linked: false,
      is_returning_guest: false,
      blacklisted_elsewhere: false,
    });
  });

  it('★ A blacklist → B thấy blacklisted_elsewhere=true, KHÔNG thấy lý do', async () => {
    await request(http).post(`/api/v1/guests/${guestA}/blacklist`).set(auth(tokenA)).send({ reason: 'Phá phòng' }).expect(201);
    const body = (await summary(tokenB, guestB).expect(200)).body.data;
    expect(body.blacklisted_elsewhere).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Phá phòng'); // không lan lý do
    expect((await personRow((await guestPersonId(guestA))!)).blacklisted_anywhere).toBe(true);
  });

  it('A un-blacklist → B blacklisted_elsewhere=false (đồng bộ ngược)', async () => {
    await request(http).post(`/api/v1/guests/${guestA}/unblacklist`).set(auth(tokenA)).expect(201);
    expect((await summary(tokenB, guestB).expect(200)).body.data.blacklisted_elsewhere).toBe(false);
  });

  it('★ A đổi giấy tờ → re-link person mới; person cũ giảm còn 1 (chỉ B)', async () => {
    const oldPid = await guestPersonId(guestA);
    await request(http).patch(`/api/v1/guests/${guestA}`).set(auth(tokenA)).send({ id_document_number: DOC_Y }).expect(200);
    const newPid = track(await guestPersonId(guestA));
    expect(newPid).not.toBe(oldPid);
    expect((await personRow(oldPid!)).tenant_link_count).toBe(1); // chỉ còn guestB
    expect((await personRow(newPid)).tenant_link_count).toBe(1); // chỉ guestA
  });

  it('erase guest (không booking) → anonymized + person_id null; person row GIỮ lại', async () => {
    const gid = (
      await createGuest(tokenA, { full_name: 'Xoá Tôi', id_document_type: 'CCCD', id_document_number: DOC_Z }).expect(201)
    ).body.data.id;
    const pid = track(await guestPersonId(gid));
    expect(pid).toBeTruthy();
    await request(http).post(`/api/v1/guests/${gid}/data-erasure`).set(auth(tokenA)).expect(200);
    expect(await guestPersonId(gid)).toBeNull();
    const anon = (await admin.query(`SELECT anonymized_at FROM guests WHERE id = $1`, [gid])).rows[0];
    expect(anon.anonymized_at).toBeTruthy();
    expect((await admin.query(`SELECT 1 FROM persons WHERE id = $1`, [pid])).rowCount).toBe(1); // person pseudonymous giữ lại
    expect((await personRow(pid)).tenant_link_count).toBe(0); // guest đã rớt khỏi đếm
  });

  it('cross-tenant: token B đọc guest của A → 404 (RLS isolation)', async () => {
    await request(http).get(`/api/v1/guests/${guestA}`).set(auth(tokenB)).expect(404);
  });
});
