import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env } from '../config/env.schema';

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
  exports: [LoggerModule],
})
export class AppLoggerModule {}
