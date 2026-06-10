import { type INestApplication } from '@nestjs/common';
import { type Express } from 'express';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from '@core/http/filters/http-exception.filter';
import { PgErrorFilter } from '@core/http/filters/pg-error.filter';
import { ZodValidationPipe } from '@core/http/pipes/zod-validation.pipe';

/**
 * Cấu hình app dùng chung giữa main.ts và e2e test — đảm bảo test chạy
 * đúng pipeline production (prefix, pipe, filter).
 */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));

  const express = app.getHttpAdapter().getInstance() as Express;
  // Sau Cloudflare/LB — req.ip lấy từ X-Forwarded-For hop đầu (docs/01 §infra)
  express.set('trust proxy', 1);
  express.disable('x-powered-by');

  // docs/05 §versioning: URL prefix /api/v1; health nằm ngoài prefix (docs/11 §5)
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/liveness', 'health/readiness', 'health/startup'],
  });

  app.useGlobalPipes(new ZodValidationPipe());
  // Thứ tự: Nest chọn filter khớp đầu tiên duyệt NGƯỢC — HttpException vào
  // HttpExceptionFilter, còn lại (pg errors, unknown) rơi xuống PgErrorFilter.
  app.useGlobalFilters(new PgErrorFilter(app.get(Logger)), new HttpExceptionFilter());

  // FE gọi thẳng api domain (không proxy qua Next — docs/13 §3); cookie refresh cần credentials
  app.enableCors({ origin: true, credentials: true });

  app.enableShutdownHooks();
}
