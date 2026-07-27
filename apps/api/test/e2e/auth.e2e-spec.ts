import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { generateSync } from 'otplib';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * Task 1.7 acceptance e2e: register → login → refresh rotation + grace
 * (double-refresh không logout-storm) → reuse detection → lockout 5 fail →
 * 2FA enable/verify/login → forgot/reset (đọc mail từ Mailpit).
 * Cần docker stack local (pnpm db:up) + đã migrate + seed plans.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';

function cookiesOf(res: Response): Record<string, string> {
  const raw = (res.headers['set-cookie'] ?? []) as unknown as string[];
  const jar: Record<string, string> = {};
  for (const line of raw) {
    const [pair] = line.split(';');
    const eq = pair!.indexOf('=');
    jar[pair!.slice(0, eq)] = pair!.slice(eq + 1);
  }
  return jar;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function latestMailpitText(to: string): Promise<string> {
  // Mailpit API (dev stack): tìm message mới nhất gửi tới `to`
  for (let attempt = 0; attempt < 10; attempt++) {
    const list = (await fetch('http://localhost:8025/api/v1/messages?limit=20').then((r) =>
      r.json(),
    )) as { messages?: { ID: string; To: { Address: string }[] }[] };
    const found = list.messages?.find((m) => m.To.some((t) => t.Address === to));
    if (found) {
      const msg = (await fetch(`http://localhost:8025/api/v1/message/${found.ID}`).then((r) =>
        r.json(),
      )) as { Text: string };
      return msg.Text;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Không thấy email gửi tới ${to} trong Mailpit`);
}

describe('Auth e2e (task 1.7)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  const slugs: string[] = [];

  function slug(name: string): string {
    const s = `e2e-${name}-${RUN}`;
    if (!slugs.includes(s)) slugs.push(s);
    return s;
  }

  function registerTenant(name: string, email: string) {
    return request(http)
      .post('/api/v1/auth/register')
      .send({
        tenant_slug: slug(name),
        tenant_display_name: `E2E ${name}`,
        email,
        password: PASSWORD,
        full_name: 'E2E Owner',
      });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(loadEnv())],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();

    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
  });

  afterAll(async () => {
    if (admin && slugs.length) {
      await admin.query(
        `DELETE FROM refresh_tokens WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = ANY($1))`,
        [slugs],
      );
      await admin.query(
        `DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = ANY($1))`,
        [slugs],
      );
      await admin.query(`DELETE FROM tenants WHERE slug = ANY($1)`, [slugs]);
      await admin.end();
    }
    await app?.close();
  });

  it('register: tạo tenant TRIAL 14 ngày + OWNER; slug trùng → 409', async () => {
    const email = `owner-${RUN}@e2e.test`;
    const res = await registerTenant('main', email).expect(201);
    expect(res.body.user.role).toBe('OWNER');
    const trialEnds = new Date(res.body.tenant.trial_ends_at).getTime();
    expect(trialEnds).toBeGreaterThan(Date.now() + 13 * 24 * 3600 * 1000);

    const dup = await registerTenant('main', `other-${RUN}@e2e.test`);
    expect(dup.status).toBe(409);
  });

  it('register: mật khẩu phổ biến → 400 AUTH_WEAK_PASSWORD', async () => {
    const res = await request(http).post('/api/v1/auth/register').send({
      tenant_slug: slug('weakpw'),
      tenant_display_name: 'Weak',
      email: `weak-${RUN}@e2e.test`,
      password: '1234567890',
      full_name: 'Weak',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AUTH_WEAK_PASSWORD');
  });

  describe('login + refresh rotation', () => {
    const email = `rot-${RUN}@e2e.test`;
    let tenantSlug: string;

    beforeAll(async () => {
      await registerTenant('rot', email).expect(201);
      tenantSlug = slug('rot');
    });

    function login(body: Record<string, unknown> = {}) {
      return request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email, password: PASSWORD, ...body });
    }

    it('login thiếu tenant context → 400', async () => {
      const res = await request(http)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TENANT_CONTEXT_MISSING');
    });

    it('sai mật khẩu → 401 AUTH_INVALID_CREDENTIALS', async () => {
      const res = await login({ password: 'WrongPassword-123' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    /**
     * Hồi quy: cookie csrf_token từng đặt HttpOnly + Path=/api/v1/auth, khiến JS
     * không đọc lại được sau khi tải lại trang → /auth/refresh trả 403 → người dùng
     * bị đăng xuất mỗi lần F5. Double-submit ĐÒI HỎI cookie đọc được, và path phải
     * là '/' vì document.cookie chỉ trả cookie path-match với trang đang mở.
     */
    it('cookie csrf_token đọc được từ JS ở mọi path; refresh_token vẫn HttpOnly', async () => {
      const res = await login().expect(200);
      const lines = (res.headers['set-cookie'] ?? []) as unknown as string[];

      // Có HAI dòng csrf_token: một dòng xoá cookie ở path cũ (giá trị rỗng) và
      // dòng set thật. Lấy đúng dòng có giá trị.
      const csrf = lines.find((l) => /^csrf_token=[^;]+/.test(l));
      expect(csrf, 'thiếu Set-Cookie csrf_token có giá trị').toBeTruthy();
      expect(csrf!.toLowerCase()).not.toContain('httponly');
      expect(csrf).toMatch(/;\s*Path=\/(?:;|$)/);

      // Dòng dọn cookie ở path cũ phải còn — thiếu nó thì trình duyệt của người dùng
      // hiện tại giữ hai cookie trùng tên và assertCsrf hỏng vĩnh viễn.
      expect(lines.some((l) => /^csrf_token=;/.test(l) && l.includes('/api/v1/auth'))).toBe(true);

      const refresh = lines.find((l) => l.startsWith('refresh_token='));
      expect(refresh!.toLowerCase()).toContain('httponly');
      expect(refresh).toContain('Path=/api/v1/auth');
    });

    it('full flow: login → sessions → refresh rotation → grace → reuse detection', async () => {
      // 1) Login
      const loginRes = await login().expect(200);
      expect(loginRes.body.data.access_token).toBeTruthy();
      const jar0 = cookiesOf(loginRes);
      expect(jar0.refresh_token).toBeTruthy();
      expect(jar0.csrf_token).toBeTruthy();
      const access0 = loginRes.body.data.access_token as string;

      // 2) Authed endpoint + session hiện tại
      const sessions = await request(http)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${access0}`)
        .set('Cookie', cookieHeader(jar0))
        .expect(200);
      expect(sessions.body.data.some((s: { current: boolean }) => s.current)).toBe(true);

      // 3) Refresh thiếu CSRF header → 403
      await request(http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar0))
        .expect(403);

      // 4) Refresh hợp lệ → rotation: cookie mới khác cookie cũ
      const refresh1 = await request(http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar0))
        .set('X-CSRF-Token', loginRes.body.data.csrf_token)
        .expect(200);
      const jar1 = cookiesOf(refresh1);
      expect(jar1.refresh_token).toBeTruthy();
      expect(jar1.refresh_token).not.toBe(jar0.refresh_token);

      // 5) DOUBLE-REFRESH (race/retry mạng): dùng lại cookie CŨ trong grace
      //    → 200 idempotent, trả CHÍNH successor — không logout-storm
      const refresh2 = await request(http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar0))
        .set('X-CSRF-Token', loginRes.body.data.csrf_token)
        .expect(200);
      const jar2 = cookiesOf(refresh2);
      expect(jar2.refresh_token).toBe(jar1.refresh_token);

      // 6) REUSE THẬT (ngoài grace 60s): backdate revoked_at -61s rồi dùng lại cookie cũ
      await admin.query(
        `UPDATE refresh_tokens SET revoked_at = now() - interval '61 seconds'
         WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
        [jar0.refresh_token],
      );
      const reuse = await request(http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar0))
        .set('X-CSRF-Token', loginRes.body.data.csrf_token);
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.code).toBe('AUTH_TOKEN_REUSE');

      // 7) Cả chain bị giết — successor cũng không dùng được nữa
      const afterKill = await request(http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar1))
        .set('X-CSRF-Token', cookiesOf(refresh1).csrf_token ?? jar1.csrf_token!);
      expect(afterKill.status).toBe(401);
    });

    it('logout revoke refresh hiện tại (idempotent)', async () => {
      const loginRes = await login().expect(200);
      const jar = cookiesOf(loginRes);
      await request(http)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookieHeader(jar))
        .set('X-CSRF-Token', loginRes.body.data.csrf_token)
        .expect(204);
      // refresh sau logout → 401
      const res = await request(http)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar))
        .set('X-CSRF-Token', loginRes.body.data.csrf_token);
      expect(res.status).toBe(401);
    });
  });

  it('lockout account-first: 5 fail / 15 phút → khoá 30 phút (423)', async () => {
    const email = `lock-${RUN}@e2e.test`;
    await registerTenant('lock', email).expect(201);

    for (let i = 0; i < 5; i++) {
      await request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', slug('lock'))
        .send({ email, password: 'WrongPassword-123' })
        .expect(401);
    }
    // lần 6 — kể cả ĐÚNG mật khẩu vẫn 423 vì account đã khoá
    const res = await request(http)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', slug('lock'))
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('AUTH_ACCOUNT_LOCKED');
  });

  it('2FA TOTP: enable → verify → login cần mã; backup code dùng đúng 1 lần', async () => {
    const email = `2fa-${RUN}@e2e.test`;
    await registerTenant('2fa', email).expect(201);
    const tenantSlug = slug('2fa');

    const login = (body: Record<string, unknown> = {}) =>
      request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email, password: PASSWORD, ...body });

    const first = await login().expect(200);
    const access = first.body.data.access_token as string;

    // Enable → nhận secret + 10 backup codes
    const enable = await request(http)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    const { secret, backup_codes: backupCodes, otpauth_url: otpauthUrl } = enable.body.data;
    expect(backupCodes).toHaveLength(10);
    expect(otpauthUrl).toContain('otpauth://totp/');

    // Verify bằng TOTP thật → kích hoạt
    await request(http)
      .post('/api/v1/auth/2fa/verify')
      .set('Authorization', `Bearer ${access}`)
      .send({ totp_code: generateSync({ secret }) })
      .expect(204);

    // Login giờ yêu cầu mã
    const noCode = await login();
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe('AUTH_2FA_REQUIRED');

    await login({ totp_code: generateSync({ secret }) }).expect(200);

    // Backup code: lần 1 OK, lần 2 (đã tiêu thụ) → 401
    const backup = backupCodes[0] as string;
    await login({ totp_code: backup }).expect(200);
    const reused = await login({ totp_code: backup });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('AUTH_2FA_CODE_INVALID');
  });

  it('forgot/reset password: link 30 phút qua email, revoke toàn bộ phiên', async () => {
    const email = `reset-${RUN}@e2e.test`;
    await registerTenant('reset', email).expect(201);
    const tenantSlug = slug('reset');

    const loginRes = await request(http)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', tenantSlug)
      .send({ email, password: PASSWORD })
      .expect(200);
    const oldJar = cookiesOf(loginRes);

    // Luôn 204 — kể cả email không tồn tại (chống enumeration)
    await request(http)
      .post('/api/v1/auth/forgot-password')
      .set('X-Tenant-Slug', tenantSlug)
      .send({ email: `khongtontai-${RUN}@e2e.test` })
      .expect(204);

    await request(http)
      .post('/api/v1/auth/forgot-password')
      .set('X-Tenant-Slug', tenantSlug)
      .send({ email })
      .expect(204);

    const mailText = await latestMailpitText(email);
    const token = /token=([\w-]+)/.exec(mailText)?.[1];
    expect(token).toBeTruthy();

    const newPassword = 'M@tKhau-Moi-2026!';
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token, new_password: newPassword })
      .expect(204);

    // Token reset dùng 1 lần
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token, new_password: newPassword })
      .expect(400);

    // Mật khẩu cũ chết, mật khẩu mới sống
    await request(http)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', tenantSlug)
      .send({ email, password: PASSWORD })
      .expect(401);
    await request(http)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', tenantSlug)
      .send({ email, password: newPassword })
      .expect(200);

    // Refresh token cũ đã bị revoke (AfterPasswordChange)
    const res = await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(oldJar))
      .set('X-CSRF-Token', loginRes.body.data.csrf_token);
    expect(res.status).toBe(401);
  });
});
