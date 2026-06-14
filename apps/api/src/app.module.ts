import { Module, RequestMethod, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthCoreModule } from '@core/auth/auth-core.module';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';
import { PermissionsGuard } from '@core/auth/permissions.guard';
import { BullmqModule } from '@core/bullmq/bullmq.module';
import { AppConfigModule } from '@core/config/config.module';
import { type Env } from '@core/config/env.schema';
import { CountersModule } from '@core/counters/counters.module';
import { CryptoModule } from '@core/crypto/crypto.module';
import { AppLoggerModule } from '@core/logger/logger.module';
import { MailModule } from '@core/mail/mail.module';
import { OutboxModule } from '@core/outbox/outbox.module';
import { PrismaModule } from '@core/prisma/prisma.module';
import { RedisModule } from '@core/redis/redis.module';
import { StorageModule } from '@core/storage/storage.module';
import { TenantGuard } from '@core/tenancy/tenant.guard';
import { TenantResolverMiddleware } from '@core/tenancy/tenant-resolver.middleware';
import { TenantStatusGuard } from '@core/tenancy/tenant-status.guard';
import { TenantStatusModule } from '@core/tenancy/tenant-status.module';
import { AssetsModule } from '@modules/assets/assets.module';
import { AuditModule } from '@modules/audit/audit.module';
import { AuthPublicModule } from '@modules/auth-public/auth-public.module';
import { BillingModule } from '@modules/billing/billing.module';
import { BookingsModule } from '@modules/bookings/bookings.module';
import { ChannelsModule } from '@modules/channels/channels.module';
import { CleaningModule } from '@modules/cleaning/cleaning.module';
import { ComplianceModule } from '@modules/compliance/compliance.module';
import { EventsModule } from '@modules/events/events.module';
import { ExpensesModule } from '@modules/expenses/expenses.module';
import { GuestsModule } from '@modules/guests/guests.module';
import { HealthModule } from '@modules/health/health.module';
import { InvoicesModule } from '@modules/invoices/invoices.module';
import { NightAuditModule } from '@modules/night-audit/night-audit.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { PricingModule } from '@modules/pricing/pricing.module';
import { PropertiesModule } from '@modules/properties/properties.module';
import { RatePlansModule } from '@modules/rate-plans/rate-plans.module';
import { ReportsModule } from '@modules/reports/reports.module';
import { ResourcesModule } from '@modules/resources/resources.module';
import { RoomsModule } from '@modules/rooms/rooms.module';
import { SubscriptionModule } from '@modules/subscription/subscription.module';

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
        TenantStatusModule,
        CryptoModule,
        CountersModule,
        BullmqModule,
        MailModule,
        OutboxModule,
        StorageModule,
        AuthCoreModule,
        AuthPublicModule,
        HealthModule,
        PropertiesModule,
        ResourcesModule,
        RoomsModule,
        RatePlansModule,
        PricingModule,
        GuestsModule,
        InvoicesModule,
        BookingsModule,
        CleaningModule,
        PaymentsModule,
        AssetsModule,
        ExpensesModule,
        BillingModule,
        NightAuditModule,
        ReportsModule,
        EventsModule,
        NotificationsModule,
        AuditModule,
        SubscriptionModule,
        ChannelsModule,
        ComplianceModule,
      ],
      providers: [
        TenantResolverMiddleware,
        // Thứ tự chạy guard: verify JWT (gắn user + tenant đã verify)
        // → yêu cầu tenant context → RBAC pha 1 (docs/04 §4)
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        // Sau RBAC: chặn write khi tenant SUSPENDED / mọi truy cập khi CHURNED (task 4.7)
        { provide: APP_GUARD, useClass: TenantStatusGuard },
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
