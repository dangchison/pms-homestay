import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectPinoLogger, LoggerModule, PinoLogger } from 'nestjs-pino';
import { ENV, type Env } from '../config/env.schema';
import { setTenantTxObserver } from '../observability/tenant-tx-metrics';

/**
 * Quan trắc cost theo tenant (docs/18 D2): đăng ký observer cho `withTenant` để log
 * unit-of-work chậm kèm `tenant_id` (soi noisy-neighbor). CHỈ đăng ký khi
 * `DB_SLOW_TX_LOG_MS > 0` → tắt thì không có observer (with-tenant no-op). Dùng pino
 * logger đã cấu hình (cùng định dạng/level) — log `evt:'slow_tenant_tx'` để dashboard
 * gom theo tenant.
 */
@Injectable()
class TenantTxLogRegistrar implements OnModuleInit, OnModuleDestroy {
  constructor(
    @InjectPinoLogger(TenantTxLogRegistrar.name) private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    const thresholdMs = this.env.DB_SLOW_TX_LOG_MS;
    if (thresholdMs <= 0) return;
    setTenantTxObserver(({ tenantId, durationMs, readOnly }) => {
      if (durationMs < thresholdMs) return;
      this.logger.warn(
        {
          evt: 'slow_tenant_tx',
          tenant_id: tenantId,
          duration_ms: durationMs,
          read_only: readOnly,
          threshold_ms: thresholdMs,
        },
        'unit-of-work tenant chậm (noisy-neighbor watch, docs/18 D2)',
      );
    });
  }

  onModuleDestroy(): void {
    setTenantTxObserver(undefined);
  }
}

/**
 * Pino structured logging + redact PII (docs/11 §2).
 * request_id: lấy từ X-Request-Id nếu client gửi, không thì sinh UUID,
 * luôn echo lại response header (docs/05 §headers).
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req, res) => {
            const headerId = req.headers['x-request-id'];
            const id = (Array.isArray(headerId) ? headerId[0] : headerId) ?? randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.*.password',
              '*.password',
              '*.password_hash',
              '*.id_document_number',
              '*.visa_number',
              '*.two_factor_secret',
              '*.token',
              'req.body.guest_info.phone',
              'req.body.guest_info.id_document_number',
            ],
            censor: '[REDACTED]',
          },
          customProps: (req) => ({
            request_id: req.id,
            tenant_id: (req as { tenantId?: string }).tenantId,
            user_id: (req as { user?: { sub?: string } }).user?.sub,
          }),
          autoLogging: {
            ignore: (req) => req.url?.startsWith('/health/') ?? false,
          },
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
  ],
  providers: [TenantTxLogRegistrar],
  exports: [LoggerModule],
})
export class AppLoggerModule {}
