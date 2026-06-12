import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  Controller,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type JwtClaims } from '@pms/shared-types';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { PermissionService } from '@core/auth/permission.service';
import { loadEnv } from '@core/config/env.schema';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';

/**
 * Task 1.8 acceptance e2e — mô phỏng đúng lỗ hổng docs/04 §4 cảnh báo:
 * endpoint PATCH /:id KHÔNG có propertyId trong request; property resolve
 * TỪ ENTITY (pha 2 authorizeOnProperty). STAFF gán property A sửa entity
 * của property B (cùng tenant) phải nhận 403.
 *
 * (Bookings thật đến ở task 2.6 — TestRbacController đứng vai resource.)
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';

/** entity id → property id (vai trò "bảng bookings" thu nhỏ) */
const ENTITY_PROPERTY = new Map<string, string>();

@Controller('test-rbac')
class TestRbacController {
  constructor(private readonly permissionService: PermissionService) {}

  @Patch('entities/:id')
  @RequirePermissions('booking.update')
  async update(@CurrentUser() user: JwtClaims, @Param('id') id: string) {
    const propertyId = ENTITY_PROPERTY.get(id);
    if (!propertyId) throw new NotFoundException();
    // Pha 2 (docs/04 §4): property TỪ ENTITY, không tin params/body
    await this.permissionService.authorizeOnProperty(user, propertyId, 'booking.update');
    return { data: { ok: true } };
  }

  @Post('refunds')
  @RequirePermissions('payment.refund')
  refund() {
    return { data: { ok: true } };
  }
}

@Module({ controllers: [TestRbacController] })
class TestRbacModule {}

describe('RBAC guard + permission cache (task 1.8)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let redis: Redis;

  const tenantSlug = `rbac-${RUN}`;
  const ownerEmail = `owner-rbac-${RUN}@e2e.test`;
  const staffEmail = `staff-rbac-${RUN}@e2e.test`;
  const propertyA = randomUUID();
  const propertyB = randomUUID();
  const entityA = randomUUID();
  const entityB = randomUUID();
  let tenantId: string;
  let staffUserId: string;
  let ownerAccess: string;
  let staffAccess: string;

  beforeAll(async () => {
    ENTITY_PROPERTY.set(entityA, propertyA);
    ENTITY_PROPERTY.set(entityB, propertyB);

    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env), TestRbacModule],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();

    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    redis = new Redis(env.REDIS_URL);

    // OWNER + tenant qua API thật
    await request(http)
      .post('/api/v1/auth/register')
      .send({
        tenant_slug: tenantSlug,
        tenant_display_name: 'RBAC E2E',
        email: ownerEmail,
        password: PASSWORD,
        full_name: 'Owner',
      })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0]
      .id;

    // Task 2.1 thêm FK user_property_roles(tenant_id, property_id) → properties:
    // phải tạo property A & B thật trước khi gán role theo property.
    await admin.query(
      `INSERT INTO properties (id, tenant_id, name, property_type, address_line, province)
       VALUES ($1, $3, 'Prop A', 'HOMESTAY', 'addr', 'Đà Nẵng'),
              ($2, $3, 'Prop B', 'HOMESTAY', 'addr', 'Đà Nẵng')`,
      [propertyA, propertyB, tenantId],
    );

    // STAFF gán property A (user.invite endpoint thuộc module users sau —
    // seed trực tiếp DB)
    const staffHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    staffUserId = (
      await admin.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role)
         VALUES ($1, $2, $3, 'Staff A', 'STAFF') RETURNING id`,
        [tenantId, staffEmail, staffHash],
      )
    ).rows[0].id;
    await admin.query(
      `INSERT INTO user_property_roles (tenant_id, user_id, property_id, role)
       VALUES ($1, $2, $3, 'STAFF')`,
      [tenantId, staffUserId, propertyA],
    );

    const login = (email: string) =>
      request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email, password: PASSWORD });
    ownerAccess = (await login(ownerEmail).expect(200)).body.data.access_token;
    staffAccess = (await login(staffEmail).expect(200)).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(
        `DELETE FROM refresh_tokens WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = $1)`,
        [tenantSlug],
      );
      await admin.query(
        `DELETE FROM user_property_roles WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = $1)`,
        [tenantSlug],
      );
      await admin.query(
        `DELETE FROM properties WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = $1)`,
        [tenantSlug],
      );
      await admin.query(
        `DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = $1)`,
        [tenantSlug],
      );
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await redis?.quit();
    await app?.close();
  });

  const patchEntity = (entityId: string, token: string) =>
    request(http).patch(`/api/v1/test-rbac/entities/${entityId}`).set('Authorization', `Bearer ${token}`);

  it('chưa đăng nhập → 401', async () => {
    await request(http).patch(`/api/v1/test-rbac/entities/${entityA}`).expect(401);
  });

  it('STAFF property A sửa entity property A → 200', async () => {
    const res = await patchEntity(entityA, staffAccess).expect(200);
    expect(res.body.data.ok).toBe(true);
  });

  it('★ STAFF property A sửa entity property B (cùng tenant) → 403 AUTHZ_PROPERTY_SCOPE', async () => {
    const res = await patchEntity(entityB, staffAccess);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHZ_PROPERTY_SCOPE');
  });

  it('OWNER toàn quyền trong tenant → 200 trên cả property B', async () => {
    await patchEntity(entityB, ownerAccess).expect(200);
  });

  it('pha 1 theo role: STAFF gọi endpoint cần payment.refund → 403 AUTHZ_NO_PERMISSION', async () => {
    const res = await request(http)
      .post('/api/v1/test-rbac/refunds')
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHZ_NO_PERMISSION');
  });

  it('deny override per-property: {"deny":["booking.update"]} chặn cả khi role cho phép', async () => {
    await admin.query(
      `UPDATE user_property_roles SET permissions = '{"deny": ["booking.update"]}'::jsonb
       WHERE user_id = $1 AND property_id = $2`,
      [staffUserId, propertyA],
    );
    await redis.del(`perm:${staffUserId}:${propertyA}`); // xoá cache 60s để thấy ngay

    const res = await patchEntity(entityA, staffAccess);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHZ_PROPERTY_SCOPE');
  });

  it('bump pv (đổi quyền) → vô hiệu hoá cache permission NGAY + token cũ bị từ chối (401)', async () => {
    const permissionService = app.get(PermissionService);
    const permKey = `perm:${staffUserId}:${propertyA}`;

    // 1 request để chắc chắn cache permission-theo-property đã được nạp
    await patchEntity(entityA, staffAccess);
    expect(await redis.exists(permKey)).toBe(1);

    await permissionService.bumpPermissionVersion(staffUserId);
    // bump vô hiệu hoá cache NGAY — không đợi TTL 60s (đóng cửa sổ stale)
    expect(await redis.exists(permKey)).toBe(0);

    const res = await patchEntity(entityA, staffAccess);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_STALE');

    // refresh-cycle mô phỏng: login lại → token mang pv mới → qua guard
    const relogin = await request(http)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', tenantSlug)
      .send({ email: staffEmail, password: PASSWORD })
      .expect(200);
    const fresh = relogin.body.data.access_token as string;
    // vẫn 403 vì deny override còn đó — nhưng KHÔNG còn 401 stale
    const after = await patchEntity(entityA, fresh);
    expect(after.status).toBe(403);
  });
});
