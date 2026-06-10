import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * E2E health + error envelope (task 1.2 acceptance) — cần PG/Redis local
 * (pnpm db:up). Dùng đúng pipeline production qua configureApp().
 */
describe('Health endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(loadEnv())],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health/liveness → 200 {status: ok} + X-Request-Id', async () => {
    const res = await request(app.getHttpServer()).get('/health/liveness').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/readiness → 200 khi DB + Redis sống', async () => {
    const res = await request(app.getHttpServer()).get('/health/readiness').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('echo lại X-Request-Id client gửi (docs/05 §headers)', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/liveness')
      .set('X-Request-Id', 'e2e-fixed-id')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('e2e-fixed-id');
  });

  it('route không tồn tại dưới /api/v1 → RFC 7807 envelope (docs/05 §error)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/__nonexistent')
      .set('X-Request-Id', 'e2e-err-id')
      .expect(404);
    expect(res.body.error).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      request_id: 'e2e-err-id',
      instance: '/api/v1/__nonexistent',
    });
    expect(res.body.error.type).toContain('https://docs.pmsapp.vn/errors/');
  });
});
