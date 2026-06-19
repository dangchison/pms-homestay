import { Injectable, Logger } from '@nestjs/common';
import { type IcalSyncResult, type SyncJobResponse, type SyncJobStatus } from '@pms/shared-types';
import { type Prisma, type sync_jobs } from '@prisma/client';
import { AppException } from '@core/http/exceptions/app.exception';
import { captureError } from '@core/sentry/sentry';
import { OutboxService } from '@core/outbox/outbox.service';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { BookingsService } from '@modules/bookings/bookings.service';
import { type IcalEvent, parseIcal } from './ical-parser';

const FETCH_TIMEOUT_MS = 30_000;
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000; // bound: chỉ xét booking check_out >= now-7d
const MISSING_THRESHOLD = 2; // huỷ booking tương lai vắng mặt ≥2 lần liên tiếp (docs/08 §3)
const TEO_RATIO = 0.5; // feed < 50% last_event_count → sanity-guard skip cancellations

interface MappingContext {
  mappingId: string;
  channelId: string;
  propertyId: string;
  resourceId: string;
  source: string;
  icalPullUrl: string | null;
  lastEventCount: number;
  timeZone: string;
}

function toSyncJobResponse(j: sync_jobs): SyncJobResponse {
  return {
    id: j.id,
    channel_id: j.channel_id,
    channel_mapping_id: j.channel_mapping_id,
    job_type: j.job_type,
    status: j.status as SyncJobStatus,
    started_at: j.started_at.toISOString(),
    finished_at: j.finished_at ? j.finished_at.toISOString() : null,
    events_processed: j.events_processed,
    events_created: j.events_created,
    events_updated: j.events_updated,
    events_removed: j.events_removed,
    conflict_count: j.conflict_count,
    error_message: j.error_message,
  };
}

/** EXCLUDE room_occupancy_no_overlap → SQLSTATE 23P01 (giữ trong meta.code của raw query). */
function isExclusionViolation(err: unknown): boolean {
  return (err as { meta?: { code?: string } })?.meta?.code === '23P01';
}

/**
 * iCal PULL worker (task 5.2, docs/08 §3). Fetch+parse feed OTA NGOÀI withTenant,
 * tạo/huỷ booking OTA qua BookingsService (createFromIcalTx/cancelFromIcalTx —
 * cùng choke-point occupancy). Conflict 23P01 → emit booking.overbooking_detected
 * (KHÔNG auto-resolve). Sanity-guard chống mất booking: feed teo >50% so
 * last_event_count → skip cancellations + alert; chỉ huỷ booking TƯƠNG LAI vắng
 * mặt ≥2 lần liên tiếp (missing_sync_count). Test gọi syncMapping(rawFeed) trực tiếp.
 */
@Injectable()
export class IcalSyncService {
  private readonly logger = new Logger(IcalSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly outbox: OutboxService,
  ) {}

  /** Sync 1 mapping. opts.rawFeed = feed có sẵn (test/Sync-now không fetch). */
  async syncMapping(
    tenantId: string,
    mappingId: string,
    opts?: { rawFeed?: string },
  ): Promise<IcalSyncResult> {
    const ctx = await this.loadContext(tenantId, mappingId);
    const jobId = await this.startJob(tenantId, ctx);
    try {
      // 1) Fetch + parse — external I/O NGOÀI withTenant (ADR-0002).
      const raw = opts?.rawFeed ?? (await this.fetchIcal(ctx.icalPullUrl));
      const events = parseIcal(raw, ctx.timeZone);
      // 2) Áp feed (diff + sanity-guard + conflict) — withTenant từng op.
      const result = await this.applyFeed(tenantId, ctx, jobId, events);
      await this.finishJob(tenantId, jobId, ctx, result);
      return result;
    } catch (err) {
      await this.failJob(tenantId, jobId, String(err));
      throw err;
    }
  }

  /** Cron 15': quét mọi mapping active của tenant ACTIVE/TRIAL (cross-tenant như night-audit). */
  async syncAllActiveMappings(): Promise<number> {
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng tenants non-RLS (ADR-0002 §5)
    const tenants = await this.prisma.tenants.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] } },
      select: { id: true },
    });
    let count = 0;
    for (const t of tenants) {
      const mappings = await withTenant(
        this.prisma,
        t.id,
        (tx) =>
          tx.channel_resource_mappings.findMany({
            where: { is_active: true, ical_pull_url: { not: null }, channels: { is_active: true } },
            select: { id: true },
          }),
        { readOnly: true },
      );
      for (const m of mappings) {
        try {
          await this.syncMapping(t.id, m.id);
          count++;
        } catch (err) {
          this.logger.warn(`iCal pull lỗi mapping ${m.id}: ${String(err)}`);
        }
      }
    }
    return count;
  }

  async listJobs(tenantId: string, channelId: string): Promise<SyncJobResponse[]> {
    const rows = await withTenant(
      this.prisma,
      tenantId,
      (tx) =>
        tx.sync_jobs.findMany({ where: { channel_id: channelId }, orderBy: { started_at: 'desc' }, take: 50 }),
      { readOnly: true },
    );
    return rows.map(toSyncJobResponse);
  }

  // ── Core: áp feed vào booking OTA ───────────────────────────────────────────
  private async applyFeed(
    tenantId: string,
    ctx: MappingContext,
    jobId: string,
    events: IcalEvent[],
  ): Promise<IcalSyncResult> {
    const now = new Date();
    const active = events.filter((e) => !e.cancelled);
    const feedByUid = new Map<string, IcalEvent>();
    for (const e of active) feedByUid.set(e.uid, e);
    // STATUS:CANCELLED = tín hiệu huỷ TƯỜNG MINH (huỷ ngay), khác vắng mặt (ngưỡng ≥2).
    const cancelledUids = new Set(events.filter((e) => e.cancelled).map((e) => e.uid));

    const existing = await withTenant(
      this.prisma,
      tenantId,
      (tx) =>
        tx.bookings.findMany({
          where: {
            channel_mapping_id: ctx.mappingId,
            external_uid: { not: null },
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            check_out: { gte: new Date(now.getTime() - HORIZON_MS) },
          },
          select: { id: true, external_uid: true, check_in: true, missing_sync_count: true, status: true },
        }),
      { readOnly: true },
    );
    const existingByUid = new Map<string, (typeof existing)[number]>();
    for (const b of existing) if (b.external_uid) existingByUid.set(b.external_uid, b);

    // Sanity-guard: feed rỗng/teo >50% so baseline → SKIP cancellations + alert.
    const guardTriggered = ctx.lastEventCount > 0 && active.length < ctx.lastEventCount * TEO_RATIO;

    let created = 0;
    let conflicts = 0;
    let cancelled = 0;
    let skipped = 0;

    // CREATE: uid trong feed CHƯA có booking → tạo (mỗi cái tx riêng để cô lập conflict).
    for (const ev of feedByUid.values()) {
      if (existingByUid.has(ev.uid)) continue;
      try {
        await withTenant(this.prisma, tenantId, (tx) =>
          this.bookings.createFromIcalTx(tx, {
            tenantId,
            propertyId: ctx.propertyId,
            resourceId: ctx.resourceId,
            channelMappingId: ctx.mappingId,
            source: ctx.source,
            externalUid: ev.uid,
            summary: ev.summary,
            checkIn: ev.start,
            checkOut: ev.end,
          }),
        );
        created++;
      } catch (err) {
        if (!isExclusionViolation(err)) throw err;
        conflicts++;
        await this.recordOverbooking(tenantId, ctx, jobId, ev);
      }
    }

    // CANCEL / missing_sync / reset — 1 tx (update/delete, không conflict).
    await withTenant(this.prisma, tenantId, async (tx) => {
      for (const b of existing) {
        const inFeed = b.external_uid ? feedByUid.has(b.external_uid) : false;
        if (inFeed) {
          if (b.missing_sync_count > 0) {
            await tx.bookings.update({ where: { id: b.id }, data: { missing_sync_count: 0 } });
          }
          continue;
        }
        // Chỉ đụng tới booking TƯƠNG LAI + CONFIRMED; quá khứ/đang ở giữ nguyên.
        if (b.check_in <= now || b.status !== 'CONFIRMED') {
          skipped++;
          continue;
        }
        const explicitlyCancelled = b.external_uid ? cancelledUids.has(b.external_uid) : false;
        // Huỷ TƯỜNG MINH (STATUS:CANCELLED) → huỷ ngay, BỎ QUA sanity-guard (tín hiệu xác định).
        if (explicitlyCancelled) {
          await this.bookings.cancelFromIcalTx(tx, {
            tenantId,
            bookingId: b.id,
            propertyId: ctx.propertyId,
            reason: 'OTA_CANCELLED',
          });
          cancelled++;
          continue;
        }
        // Vắng mặt (không CANCELLED): sanity-guard bảo vệ — feed nghi ngờ thì KHÔNG đụng.
        if (guardTriggered) {
          skipped++;
          continue;
        }
        const newMissing = b.missing_sync_count + 1;
        if (newMissing >= MISSING_THRESHOLD) {
          await this.bookings.cancelFromIcalTx(tx, {
            tenantId,
            bookingId: b.id,
            propertyId: ctx.propertyId,
            reason: 'OTA_SYNC_REMOVED',
          });
          cancelled++;
        } else {
          await tx.bookings.update({ where: { id: b.id }, data: { missing_sync_count: newMissing } });
          skipped++;
        }
      }
    });

    if (guardTriggered) {
      await this.log(
        tenantId,
        jobId,
        'WARN',
        `Sanity-guard: feed ${active.length} sự kiện < 50% baseline ${ctx.lastEventCount} → bỏ qua huỷ booking`,
        { feed_count: active.length, last_event_count: ctx.lastEventCount },
      );
      // Manual capture (docs/11 §3) — sanity-guard kích hoạt = feed OTA khả nghi, đáng theo dõi.
      captureError(new Error('iCal sanity-guard triggered'), {
        tenantId,
        level: 'warning',
        tags: { kind: 'ical_sanity_guard' },
        extra: { mappingId: ctx.mappingId, feed_count: active.length, last_event_count: ctx.lastEventCount },
      });
    }

    const status: SyncJobStatus = conflicts > 0 ? 'PARTIAL' : 'SUCCESS';
    return { status, feed_count: active.length, created, cancelled, conflicts, skipped, guard_triggered: guardTriggered };
  }

  // ── Fetch (NGOÀI tx) ────────────────────────────────────────────────────────
  private async fetchIcal(url: string | null): Promise<string> {
    if (!url) {
      throw new AppException({ code: 'ICAL_PULL_URL_MISSING', title: 'Mapping chưa cấu hình ical_pull_url', status: 422 });
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`iCal fetch HTTP ${res.status}`);
    return res.text();
  }

  // ── sync_jobs / sync_logs + state mapping (withTenant) ──────────────────────
  private async loadContext(tenantId: string, mappingId: string): Promise<MappingContext> {
    return withTenant(
      this.prisma,
      tenantId,
      async (tx) => {
        const mapping = await tx.channel_resource_mappings.findFirst({
          where: { id: mappingId },
          include: { channels: { select: { id: true, property_id: true, channel_type: true } } },
        });
        if (!mapping) {
          throw new AppException({ code: 'CHANNEL_MAPPING_NOT_FOUND', title: 'Mapping không tồn tại', status: 404 });
        }
        const tenant = await tx.tenants.findUnique({ where: { id: tenantId }, select: { timezone: true } });
        return {
          mappingId: mapping.id,
          channelId: mapping.channels.id,
          propertyId: mapping.channels.property_id,
          resourceId: mapping.resource_id,
          source: mapping.channels.channel_type,
          icalPullUrl: mapping.ical_pull_url,
          lastEventCount: mapping.last_event_count,
          timeZone: tenant?.timezone ?? 'Asia/Ho_Chi_Minh',
        };
      },
      { readOnly: true },
    );
  }

  private async startJob(tenantId: string, ctx: MappingContext): Promise<string> {
    return withTenant(this.prisma, tenantId, async (tx) => {
      const job = await tx.sync_jobs.create({
        data: {
          tenant_id: tenantId,
          channel_id: ctx.channelId,
          channel_mapping_id: ctx.mappingId,
          job_type: 'PULL_ICAL',
          status: 'RUNNING',
        },
      });
      return job.id;
    });
  }

  private async finishJob(
    tenantId: string,
    jobId: string,
    ctx: MappingContext,
    result: IcalSyncResult,
  ): Promise<void> {
    await withTenant(this.prisma, tenantId, async (tx) => {
      await tx.sync_jobs.update({
        where: { id: jobId },
        data: {
          status: result.status,
          finished_at: new Date(),
          events_processed: result.feed_count,
          events_created: result.created,
          events_removed: result.cancelled,
          conflict_count: result.conflicts,
        },
      });
      // last_event_count CHỈ cập nhật khi feed đáng tin (guard không kích hoạt) — giữ baseline.
      await tx.channel_resource_mappings.update({
        where: { id: ctx.mappingId },
        data: {
          last_pulled_at: new Date(),
          ...(result.guard_triggered ? {} : { last_event_count: result.feed_count }),
        },
      });
    });
  }

  private async failJob(tenantId: string, jobId: string, error: string): Promise<void> {
    await withTenant(this.prisma, tenantId, (tx) =>
      tx.sync_jobs.update({
        where: { id: jobId },
        data: { status: 'FAILED', finished_at: new Date(), error_message: error.slice(0, 2000) },
      }),
    ).catch((err: unknown) => this.logger.error(`failJob lỗi: ${String(err)}`));
  }

  private async log(
    tenantId: string,
    jobId: string,
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await withTenant(this.prisma, tenantId, (tx) =>
      tx.sync_logs.create({
        data: {
          tenant_id: tenantId,
          sync_job_id: jobId,
          level,
          message,
          payload: (payload ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
    ).catch(() => undefined);
  }

  /** Conflict iCal: emit booking.overbooking_detected + log WARN (tx riêng — KHÔNG auto-resolve). */
  private async recordOverbooking(
    tenantId: string,
    ctx: MappingContext,
    jobId: string,
    ev: IcalEvent,
  ): Promise<void> {
    await withTenant(this.prisma, tenantId, async (tx) => {
      await this.outbox.publish(tx, {
        event_type: 'booking.overbooking_detected',
        aggregate_type: 'booking',
        aggregate_id: ctx.mappingId,
        payload: {
          property_id: ctx.propertyId,
          resource_id: ctx.resourceId,
          channel_mapping_id: ctx.mappingId,
          external_uid: ev.uid,
          check_in: ev.start.toISOString(),
          check_out: ev.end.toISOString(),
        },
      });
      await tx.sync_logs.create({
        data: {
          tenant_id: tenantId,
          sync_job_id: jobId,
          level: 'WARN',
          message: `Overbooking: listing ${ev.uid} trùng khoảng đã đặt — KHÔNG tạo (cần xử lý tay)`,
          payload: { external_uid: ev.uid } as Prisma.InputJsonValue,
        },
      });
    });
  }
}
