import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '@core/config/env.schema';

/**
 * Sinh đặc tả OpenAPI TĨNH (`docs/openapi.json`) — KHÔNG cần DB/Redis chạy.
 *
 * Dùng NestFactory **preview mode**: dựng graph module để Swagger quét metadata
 * route/controller, nhưng KHÔNG khởi tạo provider (không gọi `$connect()` Prisma
 * hay kết nối Redis) → chạy được ở CI / máy dev không có hạ tầng.
 *
 * Runtime KHÔNG expose Swagger ở production (docs/11 §observability) — bản
 * `docs/openapi.json` commit vào repo là nguồn tham chiếu API surface tĩnh.
 *
 * Chạy: `pnpm --filter @pms/api build && pnpm --filter @pms/api openapi:export`
 */
async function main(): Promise<void> {
  const env = loadEnv();

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');

  const app = await NestFactory.create(AppModule.forRoot(env), {
    preview: true,
    logger: false,
  });
  // Khớp prefix production (app.setup.ts) → path trong spec có /api/v1.
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/liveness', 'health/readiness', 'health/startup'],
  });

  const config = new DocumentBuilder()
    .setTitle('PMS Homestay API')
    .setDescription(
      'API multi-tenant cho PMS homestay/khách sạn nhỏ VN. ' +
        'Auth: `Authorization: Bearer <access_token>` + header `X-Tenant-Slug`. ' +
        'Sinh tĩnh bằng `pnpm --filter @pms/api openapi:export`.',
    )
    .setVersion('v1')
    .addBearerAuth()
    .build();

  const doc = SwaggerModule.createDocument(app, config);
  const out = join(__dirname, '../../../docs/openapi.json');
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

  const pathCount = Object.keys(doc.paths ?? {}).length;
  console.log(`✔ OpenAPI: ${pathCount} path → ${out}`);

  await app.close();
}

main().catch((err: unknown) => {
  console.error('❌ export-openapi thất bại:', err);
  process.exit(1);
});
