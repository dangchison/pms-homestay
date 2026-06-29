import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
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
import { MailService } from '@core/mail/mail.service';
import { type NotificationSink } from '@core/outbox/notification-sink';
import { type ClaimedOutboxEvent } from '@core/outbox/outbox.service';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import {
  channelsFor,
  type NotificationEventInput,
  type NotificationTarget,
  renderTemplate,
  roleSeesCategory,
} from './notification-targets';

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
 * dòng/kênh (idempotent ON CONFLICT) + side-effect (email SMTP best-effort; SMS/ZNS
 * stub). Test gọi processEvent trực tiếp (như các worker khác).
 */
@Injectable()
export class NotificationsService implements NotificationSink {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
    private readonly mail: MailService,
    private readonly emailTemplate: EmailTemplateService,
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

  private async routeTargets(event: NotificationEventInput): Promise<NotificationTarget[]> {
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
      for (const channel of channelsFor(event.event_type)) {
        targets.push({ userId: u.id, email: u.email, channel, title, body, metadata });
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

    // Side-effect NGOÀI tx (ADR-0002): email best-effort; SMS/ZNS stub (provider sau).
    if (t.channel === 'EMAIL' && t.email) {
      // B2: gửi kèm HTML có thương hiệu (Handlebars) + text fallback.
      await this.mail.send({
        to: t.email,
        subject: t.title,
        text: `${t.body}\n\n— PMS Homestay`,
        html: this.emailTemplate.render({ title: t.title, body: t.body }),
      });
    } else if (t.channel === 'SMS' || t.channel === 'ZNS') {
      this.logger.log(`[stub ${t.channel}] user=${t.userId} "${t.title}" — provider chưa cấu hình`);
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
