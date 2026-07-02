import { Injectable, Logger } from '@nestjs/common';
import {
  type JwtClaims,
  type ListOutboundMessagesQuery,
  type OutboundChannel,
  type OutboundMessageResponse,
  type OutboundStatus,
} from '@pms/shared-types';
import { Prisma, type outbound_messages } from '@prisma/client';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';

/** Tham số ghi 1 dòng outbound_messages (sau khi provider.send xong, NGOÀI tx gửi). */
export interface RecordOutboundInput {
  channel: OutboundChannel;
  provider: string;
  providerMessageId: string | null;
  recipient: string;
  title: string;
  body: string;
  status: OutboundStatus;
  errorReason?: string;
  eventId?: string | null;
  bookingId?: string | null;
  guestId?: string | null;
  metadata?: Record<string, unknown>;
}

function toResponse(m: outbound_messages): OutboundMessageResponse {
  return {
    id: m.id,
    channel: m.channel as OutboundChannel,
    provider: m.provider,
    provider_message_id: m.provider_message_id,
    recipient: m.recipient,
    title: m.title,
    status: m.status as OutboundStatus,
    created_at: m.created_at.toISOString(),
  };
}

/**
 * ★ OutboundMessagesService (Đợt 4 / M1, docs/18) — ghi + đọc sổ gửi kênh ngoài.
 * recordOutbound(): NotificationsService gọi sau khi provider.send() (kênh SMS/ZNS)
 * để lưu 1 dòng truy vết. listOutbound(): REST GET /notifications/outbound tenant-scoped
 * (perm audit_log.read). Bảng PER-TENANT → mọi ghi/đọc qua withTenant (RLS).
 */
@Injectable()
export class OutboundMessagesService {
  private readonly logger = new Logger(OutboundMessagesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ghi 1 dòng outbound_messages TRONG withTenant (RLS: tenant_id khớp GUC). Là
   * side-effect audit best-effort: booking_id/guest_id chỉ mang tính tham chiếu
   * (payload event). Nếu ref không còn tồn tại (FK P2003) → ghi lại KHÔNG link
   * (dòng audit vẫn còn), log cảnh báo — KHÔNG chặn luồng gửi thông báo.
   */
  async recordOutbound(tenantId: string, input: RecordOutboundInput): Promise<void> {
    const base: Prisma.outbound_messagesUncheckedCreateInput = {
      tenant_id: tenantId,
      channel: input.channel,
      provider: input.provider,
      provider_message_id: input.providerMessageId,
      recipient: input.recipient,
      title: input.title,
      body: input.body,
      status: input.status,
      error_reason: input.errorReason ?? null,
      event_id: input.eventId ?? null,
      // Composite FK NULLABLE (ADR-0005): chỉ set khi payload có — enforce khi có giá trị.
      booking_id: input.bookingId ?? null,
      guest_id: input.guestId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    };
    try {
      await withTenant(this.prisma, tenantId, (tx) => tx.outbound_messages.create({ data: base }));
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003' &&
        (base.booking_id !== null || base.guest_id !== null)
      ) {
        // Ref booking/guest không còn (vd đã xoá) — ghi audit KHÔNG link để không mất vết.
        this.logger.warn(
          `outbound_messages FK ref không hợp lệ (booking_id/guest_id) — ghi không link. tenant=${tenantId} channel=${input.channel}`,
        );
        await withTenant(this.prisma, tenantId, (tx) =>
          tx.outbound_messages.create({ data: { ...base, booking_id: null, guest_id: null } }),
        );
        return;
      }
      throw err;
    }
  }

  /** REST: danh sách outbound của tenant hiện tại (mới nhất trước), lọc theo kênh + limit. */
  async listOutbound(user: JwtClaims, query: ListOutboundMessagesQuery): Promise<OutboundMessageResponse[]> {
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.outbound_messages.findMany({
          where: { ...(query.channel ? { channel: query.channel } : {}) },
          orderBy: { created_at: 'desc' },
          take: query.limit,
        }),
      { readOnly: true },
    );
    return rows.map(toResponse);
  }
}
