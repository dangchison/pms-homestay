// OTel PHẢI init trước khi express/pg/ioredis được require (auto-instrumentation)
import '@core/otel/otel';
import 'reflect-metadata';
import { loadEnv } from '@core/config/env.schema';

async function bootstrap(): Promise<void> {
  // 1) Env zod fail-fast — crash sớm, lỗi rõ ràng (docs/11 §env)
  const env = loadEnv();

  // 2) Import động để chắc chắn OTel đã chạy trước khi framework load
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./app.setup');

  const app = await NestFactory.create(AppModule.forRoot(env), { bufferLogs: true });
  configureApp(app);

  // 3) Swagger — CHỈ dev (docs/11: không lộ schema ở prod)
  if (env.NODE_ENV === 'development') {
    const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
    const config = new DocumentBuilder()
      .setTitle('PMS Homestay API')
      .setVersion('v1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  await app.listen(env.API_PORT, '0.0.0.0');
}

void bootstrap();
