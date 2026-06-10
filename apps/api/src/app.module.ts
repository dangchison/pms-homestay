import { Module, RequestMethod, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from '@core/config/config.module';
import { type Env } from '@core/config/env.schema';
import { AppLoggerModule } from '@core/logger/logger.module';
import { PrismaModule } from '@core/prisma/prisma.module';
import { RedisModule } from '@core/redis/redis.module';
import { TenantGuard } from '@core/tenancy/tenant.guard';
import { TenantResolverMiddleware } from '@core/tenancy/tenant-resolver.middleware';
import { HealthModule } from '@modules/health/health.module';

/**
 * Root module — nhận env đã validate từ bootstrap (fail-fast trước khi
 * bất kỳ provider nào chạm tới process.env).
 */
@Module({})
export class AppModule implements NestModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(env),
        AppLoggerModule,
        PrismaModule,
        RedisModule,
        HealthModule,
      ],
      providers: [
        TenantResolverMiddleware,
        // Mọi route đều yêu cầu tenant context, trừ @Public/@SkipTenantScope
        { provide: APP_GUARD, useClass: TenantGuard },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // '{*splat}' = cú pháp wildcard path-to-regexp v8 (Express 5 / Nest 11)
    consumer
      .apply(TenantResolverMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
