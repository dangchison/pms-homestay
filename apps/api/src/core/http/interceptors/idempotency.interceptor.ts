import { createHash } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { type Request, type Response } from 'express';
import { Observable, concatMap, of } from 'rxjs';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';

/**
 * Idempotency cho POST tạo entity quan trọng (docs/05 §4): header Idempotency-Key
 * bắt buộc; lưu (key, tenant) + hash body vào `idempotency_keys`.
 * - chưa có → claim (lock) → chạy handler → lưu response (replay sau).
 * - hoàn tất + cùng hash → trả response đã lưu (idempotent).
 * - khác hash → 409 IDEMPOTENCY_KEY_REUSE_DIFFERENT_BODY.
 * - đang xử lý (locked, race) → 409 REQUEST_IN_PROGRESS.
 * - handler lỗi → nhả khoá để client retry cùng key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request & { tenantId?: string; user?: JwtClaims }>();
    const res = context.switchToHttp().getResponse<Response>();

    const headerKey = req.headers['idempotency-key'];
    const key = Array.isArray(headerKey) ? headerKey[0] : headerKey;
    if (!key) {
      throw new AppException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        title: 'Thiếu header Idempotency-Key',
        status: 400,
      });
    }
    const tenantId = req.tenantId;
    if (!tenantId) {
      throw new AppException({
        code: 'TENANT_CONTEXT_MISSING',
        title: 'Thiếu tenant context',
        status: 400,
      });
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');
    const requestPath = (req.originalUrl ?? req.url).split('?')[0] ?? '';
    const userId = req.user?.sub;

    const outcome = await withTenant(this.prisma, tenantId, async (tx) => {
      const existing = await tx.idempotency_keys.findFirst({ where: { key } });
      if (!existing) {
        try {
          await tx.idempotency_keys.create({
            data: {
              key,
              tenant_id: tenantId,
              user_id: userId,
              request_path: requestPath,
              request_hash: requestHash,
              locked_at: new Date(),
            },
          });
        } catch {
          return { action: 'in_progress' as const }; // race: ai đó vừa claim cùng key
        }
        return { action: 'proceed' as const };
      }
      if (!existing.completed_at) return { action: 'in_progress' as const };
      if (existing.request_hash !== requestHash) return { action: 'reuse_diff' as const };
      return {
        action: 'replay' as const,
        status: existing.response_status,
        body: existing.response_body,
      };
    });

    if (outcome.action === 'in_progress') {
      throw new AppException({
        code: 'REQUEST_IN_PROGRESS',
        title: 'Yêu cầu cùng Idempotency-Key đang được xử lý',
        status: 409,
      });
    }
    if (outcome.action === 'reuse_diff') {
      throw new AppException({
        code: 'IDEMPOTENCY_KEY_REUSE_DIFFERENT_BODY',
        title: 'Idempotency-Key đã dùng cho nội dung khác',
        status: 409,
      });
    }
    if (outcome.action === 'replay') {
      if (outcome.status) res.status(outcome.status);
      return of(outcome.body);
    }

    // proceed: chạy handler → lưu response (hoặc nhả khoá nếu lỗi)
    return next.handle().pipe(
      concatMap(async (body) => {
        await withTenant(this.prisma, tenantId, (tx) =>
          tx.idempotency_keys.updateMany({
            where: { key },
            data: { response_status: res.statusCode, response_body: body as object, completed_at: new Date() },
          }),
        );
        return body;
      }),
      // lỗi → xoá khoá chưa hoàn tất để client retry, rồi ném lại lỗi gốc
      (source) =>
        new Observable((subscriber) => {
          source.subscribe({
            next: (v) => subscriber.next(v),
            complete: () => subscriber.complete(),
            error: (err) => {
              void withTenant(this.prisma, tenantId, (tx) =>
                tx.idempotency_keys.deleteMany({ where: { key, completed_at: null } }),
              )
                .catch(() => undefined)
                .finally(() => subscriber.error(err));
            },
          });
        }),
    );
  }
}
