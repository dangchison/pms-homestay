import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';
import { CircuitBreaker } from '@modules/guests/circuit-breaker';
import { OcrService } from '@modules/guests/ocr.service';

/**
 * ★ Acceptance task 7.1 (docs/12 §3): OCR CCCD qua FPT.AI — service gọi ngoài tx
 * (timeout 15s, retry 1, circuit breaker); POST /guests/scan-id trả extracted,
 * KHÔNG persist raw; ảnh upload pre-signed (tier VN); fallback nhập tay. Test bypass
 * HTTP qua seam rawOcr; circuit breaker test thuần (clock tiêm).
 */

// ── Unit thuần: CircuitBreaker (không cần app) ─────────────────────────────────
describe('CircuitBreaker (task 7.1)', () => {
  it('mở sau ngưỡng fail liên tiếp; half-open sau cooldown; success → đóng', () => {
    let now = 1000;
    const cb = new CircuitBreaker(2, 500, () => now);
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.isOpen).toBe(false); // 1 < ngưỡng 2
    cb.recordFailure();
    expect(cb.isOpen).toBe(true); // đạt ngưỡng → mở
    expect(cb.canRequest()).toBe(false); // chặn trong cooldown
    now += 500; // hết cooldown
    expect(cb.canRequest()).toBe(true); // half-open: cho thử
    cb.recordSuccess(); // thử thành công → đóng
    expect(cb.isOpen).toBe(false);
    expect(cb.canRequest()).toBe(true);
  });
});

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `ocr-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;

describe('OCR CCCD scan-id (task 7.1)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const guestCount = async (): Promise<number> =>
    (await admin.query(`SELECT count(*)::int AS n FROM guests WHERE tenant_id = $1`, [tenantId])).rows[0].n;

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    await request(http)
      .post('/api/v1/auth/register')
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'OCR E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]); // cascade audit_logs (4.5)
      await admin.end();
    }
    await app?.close();
  });

  it('OcrService (seam rawOcr) → map đúng field + parse ngày VN dd/mm/yyyy; KHÔNG ghi DB', async () => {
    const before = await guestCount();
    const raw = {
      errorCode: 0,
      errorMessage: '',
      data: [
        {
          id: '012345678901',
          name: 'NGUYEN VAN A',
          dob: '15/03/1990',
          sex: 'NAM',
          nationality: 'VIỆT NAM',
          type: 'chip_front',
          type_new: 'CCCD',
          issue_date: '20/01/2021',
          issue_loc: 'Cục Cảnh sát ĐKQL cư trú',
          address: 'Hải Châu, Đà Nẵng',
        },
      ],
    };
    const out = await app.get(OcrService).scanIdDocument(`cccd/${tenantId}/x/front.jpg`, { rawOcr: raw });
    expect(out.document_number).toBe('012345678901');
    expect(out.document_type).toBe('CCCD'); // type_new ưu tiên
    expect(out.full_name).toBe('NGUYEN VAN A');
    expect(out.date_of_birth).toBe('1990-03-15'); // dd/mm/yyyy → ISO
    expect(out.issue_date).toBe('2021-01-20');
    expect(out.gender).toBe('NAM');
    expect(out.address).toBe('Hải Châu, Đà Nẵng');
    // KHÔNG persist: số khách không đổi sau scan.
    expect(await guestCount()).toBe(before);
  });

  it('OcrService: data rỗng → field null (không crash)', async () => {
    const out = await app.get(OcrService).scanIdDocument('k', { rawOcr: { errorCode: 0, data: [] } });
    expect(out.document_number).toBeNull();
    expect(out.full_name).toBeNull();
    expect(out.nationality).toBe('VN'); // mặc định VN khi thiếu
  });

  it('POST /guests/scan-id: FPT chưa cấu hình (test env) → 503 (fallback nhập tay)', async () => {
    await request(http)
      .post('/api/v1/guests/scan-id')
      .set(auth())
      .send({ image_key: `cccd/${tenantId}/abc/front.jpg` })
      .expect(503);
  });

  it('POST /guests/scan-id: image_key sai tenant prefix → 400 (chống đọc ảnh tenant khác)', async () => {
    await request(http)
      .post('/api/v1/guests/scan-id')
      .set(auth())
      .send({ image_key: 'cccd/00000000-0000-0000-0000-000000000000/abc/front.jpg' })
      .expect(400);
  });

  it('POST /guests/id-scan/presign → 200 key tier VN scoped tenant + upload_url ký', async () => {
    const r = await request(http)
      .post('/api/v1/guests/id-scan/presign')
      .set(auth())
      .send({ side: 'front', content_type: 'image/jpeg' })
      .expect(200);
    expect(r.body.data.key).toMatch(new RegExp(`^cccd/${tenantId}/`));
    expect(r.body.data.key.endsWith('/front.jpeg')).toBe(true); // image/jpeg → ext 'jpeg'
    expect(r.body.data.upload_url).toContain('X-Amz-Signature');
    expect(r.body.data.expires_in).toBe(900);
  });

  it('guest create lưu id_document_scan_url + trả lại ở get', async () => {
    const key = `cccd/${tenantId}/zzz/front.jpg`;
    const created = await request(http)
      .post('/api/v1/guests')
      .set(auth())
      .send({ full_name: 'Trần Thị B', id_document_scan_url: key })
      .expect(201);
    expect(created.body.data.id_document_scan_url).toBe(key);
    const got = await request(http).get(`/api/v1/guests/${created.body.data.id}`).set(auth()).expect(200);
    expect(got.body.data.id_document_scan_url).toBe(key);
  });
});
