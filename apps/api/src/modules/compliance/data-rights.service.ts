import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type ConsentResponse,
  type DataCorrectionRequest,
  type DataErasureResponse,
  type JwtClaims,
} from '@pms/shared-types';
import { Prisma, type data_processing_consents, type guests } from '@prisma/client';
import { AuditService } from '@modules/audit/audit.service';
import { GuestsService } from '@modules/guests/guests.service';
import { EncryptionService } from '@core/crypto/encryption.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { StorageService } from '@core/storage/storage.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { buildDataExportZip } from './data-export.builder';

const RETENTION_YEARS = 5; // docs/12 §4 — giữ số giấy tờ/CCCD 5 năm sau lần ở cuối

type Tx = Prisma.TransactionClient;

function addYears(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return x;
}
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toConsentResponse(c: data_processing_consents): ConsentResponse {
  return {
    id: c.id,
    guest_id: c.guest_id,
    consent_type: c.consent_type,
    consent_text_hash: c.consent_text_hash,
    granted_at: c.granted_at.toISOString(),
    revoked_at: c.revoked_at ? c.revoked_at.toISOString() : null,
  };
}

/**
 * Quyền chủ thể dữ liệu — Nghị định 13 (task 7.3, docs/12 §4): consent (đồng ý/thu
 * hồi), data-export (zip toàn bộ data — Right to Access/Portability), data-erasure
 * (ẩn danh + legal-hold matrix: GIỮ số giấy tờ tới hạn lưu trú/CCCD 5 năm dù khách
 * yêu cầu xoá), data-correction (sửa — uỷ thác GuestsService). Cron ẩn danh khách
 * không booking ≥5 năm. Audit READ_PII (export) / DELETE (erasure).
 */
@Injectable()
export class DataRightsService {
  private readonly logger = new Logger(DataRightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly guests: GuestsService,
  ) {}

  // ── Consents ────────────────────────────────────────────────────────────────
  async listConsents(guestId: string, tenantId: string): Promise<ConsentResponse[]> {
    const rows = await withTenant(
      this.prisma,
      tenantId,
      async (tx) => {
        await this.assertGuestTx(tx, guestId);
        return tx.data_processing_consents.findMany({
          where: { guest_id: guestId },
          orderBy: { granted_at: 'desc' },
        });
      },
      { readOnly: true },
    );
    return rows.map(toConsentResponse);
  }

  async grantConsent(
    guestId: string,
    tenantId: string,
    dto: { consent_type: string; consent_text: string },
    ip: string | null,
    ua: string | null,
  ): Promise<ConsentResponse> {
    const hash = createHash('sha256').update(dto.consent_text).digest('hex');
    const row = await withTenant(this.prisma, tenantId, async (tx) => {
      await this.assertGuestTx(tx, guestId);
      return tx.data_processing_consents.create({
        data: {
          tenant_id: tenantId,
          guest_id: guestId,
          consent_type: dto.consent_type,
          consent_text: dto.consent_text,
          consent_text_hash: hash,
          ip_address: ip ?? undefined,
          user_agent: ua ?? undefined,
        },
      });
    });
    return toConsentResponse(row);
  }

  async revokeConsent(guestId: string, consentId: string, tenantId: string): Promise<ConsentResponse> {
    const row = await withTenant(this.prisma, tenantId, async (tx) => {
      const c = await tx.data_processing_consents.findFirst({ where: { id: consentId, guest_id: guestId } });
      if (!c) throw new AppException({ code: 'CONSENT_NOT_FOUND', title: 'Không tìm thấy consent', status: 404 });
      if (c.revoked_at) return c;
      return tx.data_processing_consents.update({ where: { id: consentId }, data: { revoked_at: new Date() } });
    });
    return toConsentResponse(row);
  }

  // ── data-export (Right to Access/Portability) ────────────────────────────────
  async exportGuestData(guestId: string, userId: string, tenantId: string): Promise<{ buffer: Buffer; filename: string }> {
    const bundle = await withTenant(
      this.prisma,
      tenantId,
      async (tx) => {
        const g = await this.assertGuestTx(tx, guestId);
        const consents = await tx.data_processing_consents.findMany({ where: { guest_id: guestId }, orderBy: { granted_at: 'desc' } });
        const bookings = await tx.bookings.findMany({ where: { guest_id: guestId }, orderBy: { check_in: 'desc' } });
        const bookingIds = bookings.map((b) => b.id);
        const invoices = bookingIds.length
          ? await tx.invoices.findMany({ where: { booking_id: { in: bookingIds } }, orderBy: { created_at: 'desc' } })
          : [];
        return { g, consents, bookings, invoices };
      },
      { readOnly: true },
    );

    let idNumber: string | null = null;
    if (bundle.g.id_document_number_enc) {
      try {
        idNumber = this.encryption.decrypt(Buffer.from(bundle.g.id_document_number_enc).toString('utf8'));
      } catch (err) {
        this.logger.warn(`Giải mã số giấy tờ guest=${guestId} (export) lỗi: ${String(err)}`);
      }
    }
    const g = bundle.g;
    const profile = {
      id: g.id,
      full_name: g.full_name,
      phone: g.phone,
      email: g.email,
      nationality: g.nationality,
      id_document_type: g.id_document_type,
      id_document_number: idNumber,
      id_document_issue_date: g.id_document_issue_date,
      id_document_issue_place: g.id_document_issue_place,
      date_of_birth: g.date_of_birth,
      gender: g.gender,
      address: g.address,
      created_at: g.created_at,
    };

    const buffer = await buildDataExportZip({
      profile,
      consents: bundle.consents.map(toConsentResponse),
      bookings: bundle.bookings,
      invoices: bundle.invoices,
    });

    // Export = đọc PII (decrypt) → 1 audit READ_PII (docs/12 §4).
    await this.audit.record({
      tenantId,
      userId,
      action: 'READ_PII',
      entityType: 'guests',
      entityId: guestId,
      afterData: { scope: 'data-export', bookings: bundle.bookings.length, invoices: bundle.invoices.length },
    });
    return { buffer, filename: `data-export-${guestId}.zip` };
  }

  // ── data-erasure (Right to Erasure) + legal-hold matrix ──────────────────────
  async eraseGuestData(guestId: string, userId: string, tenantId: string): Promise<DataErasureResponse> {
    const now = new Date();
    const outcome = await withTenant(this.prisma, tenantId, async (tx) => {
      const g = await this.assertGuestTx(tx, guestId);
      if (g.anonymized_at) {
        return {
          held: g.id_document_number_enc !== null,
          holdUntil: g.legal_hold_until,
          scanKey: null as string | null,
        };
      }
      // Legal-hold: giữ số giấy tờ tới `lần ở cuối + 5 năm` (lưu trú công an/CCCD).
      const stays = await tx.bookings.findMany({
        where: { guest_id: guestId, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
        select: { actual_check_out: true, check_out: true },
      });
      let lastEnd: Date | null = null;
      for (const b of stays) {
        const end = b.actual_check_out ?? b.check_out;
        if (!lastEnd || end > lastEnd) lastEnd = end;
      }
      const holdUntil = lastEnd ? addYears(lastEnd, RETENTION_YEARS) : null;
      const eraseId = !holdUntil || holdUntil <= now;
      const scanKey = await this.anonymizeGuestTx(tx, g, eraseId, eraseId ? null : holdUntil, now);
      return { held: !eraseId, holdUntil: eraseId ? null : holdUntil, scanKey };
    });

    if (outcome.scanKey) {
      // Xoá ảnh CCCD khỏi S3 — best-effort (CI không có MinIO; prod xoá thật).
      await this.storage.deleteObject(outcome.scanKey).catch((err: unknown) =>
        this.logger.warn(`Xoá ảnh CCCD S3 (erasure) lỗi: ${String(err)}`),
      );
    }

    await this.audit.record({
      tenantId,
      userId,
      action: 'DELETE',
      entityType: 'guests',
      entityId: guestId,
      afterData: { scope: 'data-erasure', held: outcome.held, legal_hold_until: outcome.holdUntil ? toDateStr(outcome.holdUntil) : null },
    });

    return {
      anonymized: true,
      legal_hold_until: outcome.held && outcome.holdUntil ? toDateStr(outcome.holdUntil) : null,
      kept: outcome.held ? ['id_document'] : [],
    };
  }

  // ── data-correction (Right to Rectification) — uỷ thác GuestsService ──────────
  async correctGuestData(guestId: string, dto: DataCorrectionRequest, user: JwtClaims) {
    return this.guests.update(guestId, dto, user);
  }

  // ── Cron: ẩn danh khách không booking ≥5 năm (NĐ13 retention) ─────────────────
  async anonymizeStaleGuests(now: Date): Promise<number> {
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng tenants non-RLS (ADR-0002 §5)
    const tenants = await this.prisma.tenants.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] } },
      select: { id: true },
    });
    let count = 0;
    for (const t of tenants) {
      count += await this.anonymizeStaleForTenant(t.id, now);
    }
    return count;
  }

  /** Ẩn danh các guest hết hạn lưu trú trong 1 tenant. Test gọi trực tiếp (targeted). */
  async anonymizeStaleForTenant(tenantId: string, now: Date): Promise<number> {
    const cutoff = addYears(now, -RETENTION_YEARS);
    const { count, scanKeys } = await withTenant(this.prisma, tenantId, async (tx) => {
      // Đủ điều kiện: (hold đã hết hạn) HOẶC (chưa ẩn danh + không hoạt động ≥5 năm); còn PII để ẩn.
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT g.id::text AS id
        FROM guests g
        LEFT JOIN bookings b ON b.guest_id = g.id AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
        WHERE g.deleted_at IS NULL
          AND (g.anonymized_at IS NULL OR g.id_document_number_enc IS NOT NULL)
        GROUP BY g.id, g.created_at, g.legal_hold_until, g.anonymized_at, g.id_document_scan_url
        HAVING (g.legal_hold_until IS NOT NULL AND g.legal_hold_until <= ${toDateStr(now)}::date)
            OR (g.legal_hold_until IS NULL
                AND COALESCE(max(COALESCE(b.actual_check_out, b.check_out)), g.created_at) < ${cutoff})
      `);
      const keys: string[] = [];
      for (const r of rows) {
        const g = await tx.guests.findFirst({ where: { id: r.id } });
        if (!g) continue;
        const key = await this.anonymizeGuestTx(tx, g, true, null, now);
        if (key) keys.push(key);
      }
      return { count: rows.length, scanKeys: keys };
    });
    for (const key of scanKeys) {
      await this.storage.deleteObject(key).catch(() => undefined); // best-effort (CI không MinIO)
    }
    return count;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  /** Ẩn danh 1 guest. eraseId=true → xoá luôn số giấy tờ; else giữ + set legal_hold_until. Trả scan key cần xoá S3 (nếu có). */
  private async anonymizeGuestTx(
    tx: Tx,
    g: guests,
    eraseId: boolean,
    holdUntil: Date | null,
    now: Date,
  ): Promise<string | null> {
    const data: Prisma.guestsUncheckedUpdateInput = {
      full_name: 'ANONYMIZED',
      phone: null,
      email: null,
      address: null,
      notes: null,
      anonymized_at: now,
    };
    let scanKey: string | null = null;
    if (eraseId) {
      data.id_document_number_enc = null;
      data.id_document_number_hash = null;
      data.id_document_last4 = null;
      data.legal_hold_until = null;
      if (g.id_document_scan_url) {
        scanKey = g.id_document_scan_url;
        data.id_document_scan_url = null;
      }
    } else {
      data.legal_hold_until = holdUntil; // @db.Date — Prisma nhận Date
    }
    await tx.guests.update({ where: { id: g.id }, data });
    return scanKey;
  }

  private async assertGuestTx(tx: Tx, guestId: string): Promise<guests> {
    const g = await tx.guests.findFirst({ where: { id: guestId } });
    if (!g) throw new AppException({ code: 'GUEST_NOT_FOUND', title: 'Khách không tồn tại', status: 404 });
    return g;
  }
}
