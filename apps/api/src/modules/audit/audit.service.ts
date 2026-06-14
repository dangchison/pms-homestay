import { Injectable, Logger } from '@nestjs/common';
import { type audit_logs, Prisma } from '@prisma/client';
import {
  type AuditAction,
  type AuditLogListQuery,
  type AuditLogListResponse,
  type AuditLogResponse,
  type JwtClaims,
} from '@pms/shared-types';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { offsetToSkipTake } from '@/shared/dto';
import { redactPii } from './audit.redact';

/** Input ghi 1 dòng audit — before/after redact PII bên trong service. */
export interface AuditRecordInput {
  tenantId: string;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  diff?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Redact + bỏ qua JSON rỗng (undefined → Prisma không ghi cột → DB NULL). */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return undefined;
  }
  return redactPii(value) as Prisma.InputJsonValue;
}

function toAuditLogResponse(r: audit_logs): AuditLogResponse {
  return {
    id: r.id,
    user_id: r.user_id,
    action: r.action as AuditAction,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    before_data: r.before_data ?? null,
    after_data: r.after_data ?? null,
    diff: r.diff ?? null,
    ip_address: r.ip_address,
    user_agent: r.user_agent,
    request_id: r.request_id,
    created_at: r.created_at.toISOString(),
  };
}

/**
 * Vết kiểm toán (task 4.5, docs/03 §audit_logs). `record()` ghi best-effort
 * (KHÔNG ném — audit hỏng không được làm fail request mutation đã commit); dùng
 * bởi AuditInterceptor (mutation HTTP) và service (READ_PII...). `query()` đọc
 * cho GET /audit-logs (quyền audit_log.read — không property-scope, toàn tenant).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await withTenant(this.prisma, input.tenantId, (tx) =>
        tx.audit_logs.create({
          data: {
            tenant_id: input.tenantId,
            user_id: input.userId ?? null,
            action: input.action,
            entity_type: input.entityType,
            entity_id: input.entityId ?? null,
            before_data: toJson(input.beforeData),
            after_data: toJson(input.afterData),
            diff: toJson(input.diff),
            ip_address: input.ip ?? null,
            user_agent: input.userAgent ?? null,
            request_id: input.requestId ?? null,
          },
        }),
      );
    } catch (err) {
      // Best-effort: chỉ cảnh báo, không lan lỗi ra request đã thành công.
      this.logger.warn(
        `Ghi audit_logs thất bại (action=${input.action} entity=${input.entityType}): ${String(err)}`,
      );
    }
  }

  async query(user: JwtClaims, q: AuditLogListQuery): Promise<AuditLogListResponse> {
    const { skip, take } = offsetToSkipTake(q);
    const where: Prisma.audit_logsWhereInput = {
      ...(q.entity_type ? { entity_type: q.entity_type } : {}),
      ...(q.entity_id ? { entity_id: q.entity_id } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.user_id ? { user_id: q.user_id } : {}),
      ...(q.from || q.to
        ? {
            created_at: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
    };

    const { rows, total } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.audit_logs.findMany({
            where,
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            skip,
            take,
          }),
          tx.audit_logs.count({ where }),
        ]);
        return { rows, total };
      },
      { readOnly: true },
    );

    return {
      data: rows.map(toAuditLogResponse),
      page_info: {
        page: q.page,
        page_size: q.page_size,
        total_items: total,
        total_pages: Math.max(1, Math.ceil(total / q.page_size)),
      },
    };
  }
}
