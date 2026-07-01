import { Injectable, Logger } from '@nestjs/common';
import {
  type CreateForeignResidenceRequest,
  type ForeignResidenceListQuery,
  type ForeignResidenceResponse,
  type ForeignResidenceStatus,
  type JwtClaims,
  type SubmitForeignResidenceResponse,
  type UpdateForeignResidenceRequest,
} from '@pms/shared-types';
import { type foreign_residence_declarations } from '@prisma/client';
import { AuditService } from '@modules/audit/audit.service';
import { PermissionService } from '@core/auth/permission.service';
import { EncryptionService } from '@core/crypto/encryption.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { type Na17Data, buildNa17Workbook } from './na17.builder';

/** Chuẩn hoá số thị thực trước khi mã hoá (bỏ khoảng trắng, in hoa) — như số giấy tờ. */
function normalizeVisa(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase();
}

/** Buffer (Node) → Uint8Array<ArrayBuffer> khớp cột Prisma Bytes. */
function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

function toDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Trường NA17 có thể ghi (visa/nhập cảnh) — dùng chung create + update. */
interface Na17WriteData {
  visa_number_enc?: Uint8Array<ArrayBuffer>;
  visa_number_last4?: string;
  visa_type?: string;
  visa_expiry?: Date;
  date_of_entry?: Date;
  port_of_entry?: string;
  intended_departure?: Date;
}

function toResponse(row: foreign_residence_declarations): ForeignResidenceResponse {
  return {
    id: row.id,
    booking_id: row.booking_id,
    guest_id: row.guest_id,
    property_id: row.property_id,
    visa_number_last4: row.visa_number_last4,
    visa_type: row.visa_type,
    visa_expiry: toDateOnly(row.visa_expiry),
    date_of_entry: toDateOnly(row.date_of_entry),
    port_of_entry: row.port_of_entry,
    intended_departure: toDateOnly(row.intended_departure),
    status: row.status as ForeignResidenceStatus,
    submitted_at: row.submitted_at ? row.submitted_at.toISOString() : null,
    xnc_reference: row.xnc_reference,
    failure_reason: row.failure_reason,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export interface Na17Result {
  buffer: Buffer;
  filename: string;
}

/**
 * Khai báo TẠM TRÚ khách NƯỚC NGOÀI (mẫu NA17, XNC) — task 9.3, docs/12 §2. CRUD dữ
 * liệu visa/nhập cảnh per-stay (1 khai báo / booking), "Gửi" lên Cục XNC (Phase 1 =
 * STUB), và xuất phiếu NA17 (giải mã số thị thực + số hộ chiếu LIVE + 1 audit READ_PII).
 * Quyền `guest.pii.read` (pha-1) + property-scope (pha-2) — như báo cáo lưu trú TT56.
 * Số thị thực mã hoá field (ADR-0007); list/get chỉ trả last4.
 */
@Injectable()
export class ForeignResidenceService {
  private readonly logger = new Logger(ForeignResidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
  ) {}

  /** Tạo khai báo cho 1 booking (guest chính) — property_id/guest_id suy từ booking. */
  async create(dto: CreateForeignResidenceRequest, user: JwtClaims): Promise<ForeignResidenceResponse> {
    const booking = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.bookings.findFirst({
          where: { id: dto.booking_id },
          select: { id: true, property_id: true, guest_id: true },
        }),
      { readOnly: true },
    );
    if (!booking) {
      throw new AppException({ code: 'BOOKING_NOT_FOUND', title: 'Đặt phòng không tồn tại', status: 404 });
    }
    if (!booking.guest_id) {
      throw new AppException({
        code: 'BOOKING_NO_GUEST',
        title: 'Đặt phòng chưa gắn khách để khai báo',
        status: 422,
      });
    }
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'guest.pii.read');

    const row = await withTenant(this.prisma, user.tnt, async (tx) => {
      const existing = await tx.foreign_residence_declarations.findFirst({
        where: { booking_id: booking.id },
        select: { id: true },
      });
      if (existing) {
        throw new AppException({
          code: 'FOREIGN_RESIDENCE_EXISTS',
          title: 'Đặt phòng đã có khai báo tạm trú',
          status: 409,
        });
      }
      return tx.foreign_residence_declarations.create({
        data: {
          tenant_id: user.tnt,
          property_id: booking.property_id,
          booking_id: booking.id,
          guest_id: booking.guest_id!,
          ...this.toWriteData(dto),
        },
      });
    });
    return toResponse(row);
  }

  async list(query: ForeignResidenceListQuery, user: JwtClaims): Promise<ForeignResidenceResponse[]> {
    await this.assertPropertyExists(query.property_id, user);
    await this.permissionService.authorizeOnProperty(user, query.property_id, 'guest.pii.read');
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.foreign_residence_declarations.findMany({
          where: { property_id: query.property_id, status: query.status },
          orderBy: { created_at: 'desc' },
        }),
      { readOnly: true },
    );
    return rows.map(toResponse);
  }

  async getById(id: string, user: JwtClaims): Promise<ForeignResidenceResponse> {
    const decl = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, decl.property_id, 'guest.pii.read');
    return toResponse(decl);
  }

  async update(
    id: string,
    dto: UpdateForeignResidenceRequest,
    user: JwtClaims,
  ): Promise<ForeignResidenceResponse> {
    const decl = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, decl.property_id, 'guest.pii.read');
    if (decl.status === 'SUBMITTED') {
      throw new AppException({
        code: 'FOREIGN_RESIDENCE_SUBMITTED',
        title: 'Khai báo đã gửi — không thể sửa',
        status: 422,
      });
    }
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.foreign_residence_declarations.update({ where: { id }, data: this.toWriteData(dto) }),
    );
    return toResponse(row);
  }

  /**
   * "Gửi" khai báo lên Cục XNC (docs/12 §2 Phase 2) — DRAFT/FAILED → SUBMITTED. Đã
   * SUBMITTED → trả nguyên trạng (idempotent). STUB dịch vụ XNC: đủ dữ liệu tối thiểu
   * (ngày nhập cảnh + ngày dự kiến rời + có thị thực hoặc miễn) → SUBMITTED; thiếu →
   * FAILED kèm lý do. Khi có tích hợp thật: thay nhánh stub bằng POST cổng XNC (NGOÀI
   * withTenant — I/O) rồi lưu `xnc_reference`.
   */
  async submit(id: string, user: JwtClaims): Promise<SubmitForeignResidenceResponse> {
    const decl = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, decl.property_id, 'guest.pii.read');
    if (decl.status === 'SUBMITTED') {
      return { id: decl.id, status: 'SUBMITTED', xnc_reference: decl.xnc_reference, failure_reason: null };
    }

    const missing: string[] = [];
    if (!decl.date_of_entry) missing.push('date_of_entry');
    if (!decl.intended_departure) missing.push('intended_departure');
    // Có thị thực hoặc được miễn thị thực (visa_type = EXEMPT).
    if (decl.visa_number_enc == null && decl.visa_type !== 'EXEMPT') missing.push('visa');
    const ok = missing.length === 0;

    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.foreign_residence_declarations.update({
        where: { id: decl.id },
        data: ok
          ? { status: 'SUBMITTED', submitted_at: new Date(), submitted_by: user.sub, failure_reason: null }
          : { status: 'FAILED', failure_reason: `Thiếu dữ liệu bắt buộc: ${missing.join(', ')}` },
      }),
    );

    await this.audit.record({
      tenantId: user.tnt,
      userId: user.sub,
      action: 'STATE_CHANGE',
      entityType: 'foreign-residence',
      entityId: decl.id,
      afterData: {
        scope: 'foreign-residence-submit',
        property_id: decl.property_id,
        booking_id: decl.booking_id,
        status: row.status,
      },
    });
    return {
      id: row.id,
      status: row.status as ForeignResidenceStatus,
      xnc_reference: row.xnc_reference,
      failure_reason: row.failure_reason,
    };
  }

  /**
   * Xuất phiếu NA17 (.xlsx) — giải mã số thị thực + số hộ chiếu của guest LIVE (như
   * police-report) rồi ghi 1 audit READ_PII scope foreign-residence-na17. KHÔNG log
   * giá trị PII (chỉ ghi đã đọc). Lỗi giải mã 1 trường → để trống, không vỡ phiếu.
   */
  async generateNa17(id: string, user: JwtClaims): Promise<Na17Result> {
    const decl = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, decl.property_id, 'guest.pii.read');

    const { guest, property, booking } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const g = await tx.guests.findFirst({ where: { id: decl.guest_id } });
        const p = await tx.properties.findFirst({
          where: { id: decl.property_id },
          select: { name: true, address_line: true, ward: true, district: true, province: true },
        });
        const b = await tx.bookings.findFirst({
          where: { id: decl.booking_id },
          select: { booking_code: true, check_in: true, check_out: true },
        });
        return { guest: g, property: p, booking: b };
      },
      { readOnly: true },
    );

    const passport = this.tryDecrypt(guest?.id_document_number_enc ?? null, `guest=${decl.guest_id}`);
    const visaNumber = this.tryDecrypt(decl.visa_number_enc, `declaration=${decl.id}`);

    const residenceAddress = property
      ? [property.address_line, property.ward, property.district, property.province]
          .filter((s): s is string => Boolean(s))
          .join(', ')
      : '';

    const data: Na17Data = {
      full_name: guest?.full_name ?? '',
      gender: guest?.gender ?? null,
      date_of_birth: toDateOnly(guest?.date_of_birth ?? null),
      nationality: guest?.nationality ?? null,
      passport_number: passport,
      visa_type: decl.visa_type,
      visa_number: visaNumber,
      visa_expiry: toDateOnly(decl.visa_expiry),
      date_of_entry: toDateOnly(decl.date_of_entry),
      port_of_entry: decl.port_of_entry,
      intended_departure: toDateOnly(decl.intended_departure),
      residence_address: residenceAddress,
      check_in: booking ? booking.check_in.toISOString() : '',
      check_out: booking ? booking.check_out.toISOString() : '',
      booking_code: booking?.booking_code ?? '',
    };

    await this.audit.record({
      tenantId: user.tnt,
      userId: user.sub,
      action: 'READ_PII',
      entityType: 'foreign-residence',
      entityId: decl.id,
      afterData: {
        scope: 'foreign-residence-na17',
        property_id: decl.property_id,
        booking_id: decl.booking_id,
      },
    });

    const buffer = await buildNa17Workbook(data);
    return { buffer, filename: `na17-${data.booking_code || decl.id}.xlsx` };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private tryDecrypt(enc: Uint8Array | null, ctx: string): string | null {
    if (!enc) return null;
    try {
      return this.encryption.decrypt(Buffer.from(enc).toString('utf8'));
    } catch (err) {
      this.logger.warn(`Giải mã ${ctx} lỗi: ${String(err)}`);
      return null;
    }
  }

  private async loadOrThrow(id: string, user: JwtClaims): Promise<foreign_residence_declarations> {
    const decl = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.foreign_residence_declarations.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!decl) {
      throw new AppException({
        code: 'FOREIGN_RESIDENCE_NOT_FOUND',
        title: 'Khai báo tạm trú không tồn tại',
        status: 404,
      });
    }
    return decl;
  }

  private async assertPropertyExists(propertyId: string, user: JwtClaims): Promise<void> {
    const prop = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.properties.findFirst({ where: { id: propertyId }, select: { id: true } }),
      { readOnly: true },
    );
    if (!prop) {
      throw new AppException({ code: 'PROPERTY_NOT_FOUND', title: 'Cơ sở không tồn tại', status: 404 });
    }
  }

  private toWriteData(dto: CreateForeignResidenceRequest | UpdateForeignResidenceRequest): Na17WriteData {
    const data: Na17WriteData = {
      visa_type: dto.visa_type,
      visa_expiry: dto.visa_expiry ? new Date(dto.visa_expiry) : undefined,
      date_of_entry: dto.date_of_entry ? new Date(dto.date_of_entry) : undefined,
      port_of_entry: dto.port_of_entry,
      intended_departure: dto.intended_departure ? new Date(dto.intended_departure) : undefined,
    };
    if (dto.visa_number !== undefined) {
      const norm = normalizeVisa(dto.visa_number);
      data.visa_number_enc = toBytes(Buffer.from(this.encryption.encrypt(norm), 'utf8'));
      data.visa_number_last4 = norm.slice(-4);
    }
    return data;
  }
}
