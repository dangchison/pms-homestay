import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuditAction, type JwtClaims } from '@pms/shared-types';
import { type Request } from 'express';
import { type Observable, concatMap } from 'rxjs';
import { AUDIT_EXPORT_KEY } from '@core/http/decorators/audit-export.decorator';
import { SKIP_AUDIT_KEY } from '@core/http/decorators/skip-audit.decorator';
import { AuditService } from './audit.service';

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** entity_type = segment tài nguyên đầu tiên sau prefix /api/v1 (vd 'bookings'). */
function extractEntityType(req: Request): string {
  const path = (req.originalUrl || req.url || '').split('?')[0] ?? '';
  const parts = path.split('/').filter(Boolean); // ['api','v1','cleaning-tasks',':id','assign']
  let i = 0;
  if (parts[i] === 'api') i++;
  if (parts[i] && /^v\d+$/.test(parts[i] as string)) i++;
  return parts[i] ?? 'unknown';
}

/**
 * POST /res        → CREATE (tạo entity)
 * POST /res/:id/verb → STATE_CHANGE (confirm/check-in/assign/...)
 * PATCH|PUT        → UPDATE
 * DELETE           → DELETE
 */
function resolveAction(method: string, hasIdParam: boolean): AuditAction {
  if (method === 'POST') return hasIdParam ? 'STATE_CHANGE' : 'CREATE';
  if (method === 'DELETE') return 'DELETE';
  return 'UPDATE'; // PATCH | PUT
}

function headerStr(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Envelope chuẩn { data: { id } } → id để gắn entity_id khi CREATE. */
function extractResponseId(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const data = (body as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const id = (data as { id?: unknown }).id;
      if (typeof id === 'string') return id;
    }
  }
  return undefined;
}

/**
 * AuditInterceptor (task 4.5, docs/03 §audit_logs) — global APP_INTERCEPTOR. Tự
 * ghi audit_logs cho MỌI mutation HTTP (POST/PATCH/PUT/DELETE) THÀNH CÔNG của
 * user đã xác thực, **và** GET có @AuditExport() → action EXPORT (B3, docs/18).
 * Bỏ qua: GET/HEAD thường, route public (thiếu tenant/user), @SkipAudit().
 * Ghi SAU handler (response đã có id) và AWAIT (deterministic + audit tin cậy);
 * record() best-effort nên không bao giờ làm fail request đã commit. before_data
 * để trống ở tầng interceptor (service tự ghi before/after khi cần); after_data =
 * body request (mutation) hoặc query (export) — đã redact PII trong AuditService.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context
      .switchToHttp()
      .getRequest<Request & { tenantId?: string; user?: JwtClaims; id?: string }>();
    const method = req.method?.toUpperCase() ?? '';

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isExport =
      this.reflector.getAllAndOverride<boolean>(AUDIT_EXPORT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const isMutation = AUDITED_METHODS.has(method);
    // Audit khi: mutation HTTP, HOẶC GET đánh dấu @AuditExport. Cả hai cần tenant+user.
    if (skip || !req.tenantId || !req.user || (!isMutation && !isExport)) {
      return next.handle();
    }

    const tenantId = req.tenantId;
    const user = req.user;
    const entityType = extractEntityType(req);
    const ip = req.ip ?? null;
    const userAgent = headerStr(req.headers['user-agent']);
    const requestId =
      (typeof req.id === 'string' ? req.id : undefined) ?? headerStr(req.headers['x-request-id']);

    // EXPORT (GET @AuditExport): after_data = query (bộ lọc xuất, không PII); không có entity_id.
    if (isExport && !isMutation) {
      const query = req.query as unknown;
      return next.handle().pipe(
        concatMap(async (responseBody) => {
          await this.audit.record({
            tenantId,
            userId: user.sub,
            action: 'EXPORT',
            entityType,
            afterData: query,
            ip,
            userAgent,
            requestId,
          });
          return responseBody;
        }),
      );
    }

    // Mutation (POST/PATCH/PUT/DELETE).
    const paramId = typeof req.params?.id === 'string' ? req.params.id : undefined;
    const action = resolveAction(method, paramId !== undefined);
    const body = req.body as unknown;
    return next.handle().pipe(
      concatMap(async (responseBody) => {
        await this.audit.record({
          tenantId,
          userId: user.sub,
          action,
          entityType,
          entityId: paramId ?? extractResponseId(responseBody),
          afterData: body,
          ip,
          userAgent,
          requestId,
        });
        return responseBody;
      }),
    );
  }
}
