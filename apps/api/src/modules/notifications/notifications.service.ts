import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import {
  type JwtClaims,
  type ListNotificationsQuery,
  type NotificationChannel,
  type NotificationResponse,
} from '@pms/shared-types';
import { Queue } from 'bullmq';
import { type notifications } from '@prisma/client';
import { QUEUE_NOTIFICATIONS } from '@core/bullmq/queues';
import { AppException } from '@core/http/exceptions/app.exception';
import { EmailTemplateService } from '@core/mail/email-template.service';
import { type NotificationSink } from '@core/outbox/notification-sink';
import { type ClaimedOutboxEvent } from '@core/outbox/outbox.service';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import {
  channelsFor,
  type DeliveryChannel,
  type NotificationEventInput,
  type NotificationTarget,
  renderTemplate,
  roleSeesCategory,
} from './notification-targets';
import { OutboundMessagesService } from './outbound-messages.service';
import { NotificationProviderRegistry } from './providers/notification-provider.registry';

function toResponse(n: notifications): NotificationResponse {
  return {
    id: n.id,
    channel: n.channel as NotificationChannel,
    title: n.title,
    body: n.body,
    metadata: (n.metadata ?? {}) as Record<string, unknown>,
    is_read: n.is_read,
    read_at: n.read_at ? n.read_at.toISOString() : null,
    created_at: n.created_at.toISOString(),
  };
}

/**
 * ★ Notifications (task 4.4, docs/10 §7). Implements NotificationSink — dispatcher
 * (4.2) enqueue 1 job/event vào queue `notifications`; worker (gated
 * ENABLE_SCHEDULERS) gọi `processEvent` → route theo role/property × kênh → ghi 1
 * dòng/kênh (idempotent ON CONFLICT) + side-effect: kênh ngoài (EMAIL/SMS/ZNS) qua
 * NotificationProviderRegistry (M1, docs/18) + ghi outbound_messages. Test gọi
 * processEvent trực tiếp (như các worker khác).
 */
@Injectable()
export class NotificationsService implements NotificationSink {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
    private readonly emailTemplate: EmailTemplateService,
    private readonly providers: NotificationProviderRegistry,
    private readonly outbound: OutboundMessagesService,
  ) {}

  /** Sink: dispatcher gọi sau khi fan-out SSE. 1 job/event, dedup jobId theo event_id. */
  async enqueue(event: ClaimedOutboxEvent): Promise<void> {
    const data: NotificationEventInput = {
      event_id: event.id,
      event_type: event.event_type,
      tenant_id: event.tenant_id,
      payload: event.payload,
    };
    await this.queue.add('event', data, {
      // BullMQ cấm ':' trong jobId (dùng làm separator key Redis) → dùng '-'.
      // Dedup theo event_id: at-least-once outbox enqueue lại cùng event → 1 job.
      jobId: `notify-${event.id}`,
      removeOnComplete: true,
      removeOnFail: 500,
    });
  }

  /** Worker + test: route recipients × kênh → deliver. Trả số bản tin đã ghi mới. */
  async processEvent(event: NotificationEventInput): Promise<{ delivered: number }> {
    const targets = await this.routeTargets(event);
    let delivered = 0;
    for (const target of targets) {
      if (await this.deliverTarget(event, target)) delivered += 1;
    }
    return { delivered };
  }

  /**
   * Route + deliver ÉP kênh cụ thể (bỏ qua channelsFor). Dùng khi cần gửi 1 kênh
   * nhất định cho recipients đủ điều kiện (vd targeted SMS/ZNS, e2e M1). Ghi
   * notifications (idempotent) + side-effect như processEvent.
   */
  async processEventForChannels(
    event: NotificationEventInput,
    channels: DeliveryChannel[],
  ): Promise<{ delivered: number }> {
    const targets = await this.routeTargets(event, channels);
    let delivered = 0;
    for (const target of targets) {
      if (await this.deliverTarget(event, target)) delivered += 1;
    }
    return { delivered };
  }

  private async routeTargets(
    event: NotificationEventInput,
    channelsOverride?: DeliveryChannel[],
  ): Promise<NotificationTarget[]> {
    const category = event.event_type.split('.')[0] ?? '';
    const propertyId = typeof event.payload['property_id'] === 'string' ? event.payload['property_id'] : null;

    const users = await withTenant(
      this.prisma,
      event.tenant_id,
      (tx) =>
        tx.users.findMany({
          where: { deleted_at: null },
          select: {
            id: true,
            email: true,
            phone: true,
            default_role: true,
            user_property_roles: { select: { property_id: true, role: true } },
          },
        }),
      { readOnly: true },
    );

    const { title, body } = renderTemplate(event.event_type);
    const targets: NotificationTarget[] = [];
    for (const u of users) {
      const sees =
        u.default_role === 'OWNER' ||
        (propertyId !== null &&
          u.user_property_roles.some((r) => r.property_id === propertyId && roleSeesCategory(r.role, category)));
      if (!sees) continue;
      const metadata: Record<string, unknown> = { event_type: event.event_type, ...event.payload };
      for (const channel of channelsOverride ?? channelsFor(event.event_type)) {
        targets.push({ userId: u.id, email: u.email, phone: u.phone, channel, title, body, metadata });
      }
    }
    return targets;
  }

  /** Ghi 1 dòng (idempotent per event+user+kênh) + side-effect. Trả true nếu là dòng MỚI. */
  private async deliverTarget(event: NotificationEventInput, t: NotificationTarget): Promise<boolean> {
    const inserted = await withTenant(this.prisma, event.tenant_id, (tx) =>
      tx.$executeRaw`
        INSERT INTO notifications (tenant_id, user_id, channel, event_id, title, body, metadata)
        VALUES (
          NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
          ${t.userId}::uuid, ${t.channel}, ${event.event_id}::uuid, ${t.title}, ${t.body},
          ${JSON.stringify(t.metadata)}::jsonb
        )
        ON CONFLICT (tenant_id, user_id, channel, event_id) WHERE event_id IS NOT NULL DO NOTHING`,
    );
    if (inserted === 0) return false; // đã gửi → idempotent skip (không gửi đôi email)

    // Side-effect NGOÀI tx (ADR-0002): MỌI kênh ngoài (EMAIL/SMS/ZNS) đi qua registry
    // → provider theo env (EMAIL=SMTP; SMS/ZNS mock|log; esms|zalo Phase sau) rồi ghi 1
    // dòng outbound_messages truy vết. IN_APP là dòng notifications thuần → không gửi ngoài.
    if (t.channel === 'EMAIL' || t.channel === 'SMS' || t.channel === 'ZNS') {
      // recipient: EMAIL=email; SMS/ZNS=số ĐT user, fallback email/userId khi chưa có.
      const recipient = t.channel === 'EMAIL' ? (t.email ?? t.userId) : (t.phone ?? t.email ?? t.userId);
      const provider = this.providers.forChannel(t.channel);
      const res = await provider.send({
        channel: t.channel,
        recipient,
        title: t.title,
        // EMAIL: giữ text footer thương hiệu + HTML (Handlebars). SMS/ZNS: body thuần.
        body: t.channel === 'EMAIL' ? `${t.body}\n\n— PMS Homestay` : t.body,
        ...(t.channel === 'EMAIL' ? { html: this.emailTemplate.render({ title: t.title, body: t.body }) } : {}),
      });
      const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
      await this.outbound.recordOutbound(event.tenant_id, {
        channel: t.channel,
        provider: provider.name,
        providerMessageId: res.providerMessageId,
        recipient,
        title: t.title,
        body: t.body,
        status: res.status,
        errorReason: res.errorReason,
        eventId: event.event_id,
        bookingId: str(t.metadata['booking_id']),
        guestId: str(t.metadata['guest_id']),
        metadata: { user_id: t.userId, ...t.metadata },
      });
    }
    return true;
  }

  // ── REST: inbox in-app của chính user ──────────────────────────────────────

  async listForUser(user: JwtClaims, query: ListNotificationsQuery): Promise<NotificationResponse[]> {
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.notifications.findMany({
          where: {
            user_id: user.sub,
            channel: 'IN_APP',
            ...(query.unread_only ? { is_read: false } : {}),
          },
          orderBy: { created_at: 'desc' },
          take: query.limit,
        }),
      { readOnly: true },
    );
    return rows.map(toResponse);
  }

  async markRead(id: string, user: JwtClaims): Promise<NotificationResponse> {
    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const res = await tx.notifications.updateMany({
        where: { id, user_id: user.sub },
        data: { is_read: true, read_at: new Date() },
      });
      if (res.count === 0) {
        throw new AppException({
          code: 'NOTIFICATION_NOT_FOUND',
          title: 'Không tìm thấy thông báo',
          status: 404,
        });
      }
      return tx.notifications.findFirstOrThrow({ where: { id } });
    });
    return toResponse(updated);
  }
}
