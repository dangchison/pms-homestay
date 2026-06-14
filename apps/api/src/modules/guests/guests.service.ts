import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type BlacklistGuestRequest,
  type CreateGuestRequest,
  type GuestIdDocumentResponse,
  type GuestResponse,
  type IdScanPresignRequest,
  type IdScanPresignResponse,
  type JwtClaims,
  type OffsetPageInfo,
  type ScanIdRequest,
  type ScanIdResponse,
  type UpdateGuestRequest,
} from '@pms/shared-types';
import { Prisma, type guests } from '@prisma/client';
import { AuditService } from '@modules/audit/audit.service';
import { EncryptionService } from '@core/crypto/encryption.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { StorageService } from '@core/storage/storage.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { offsetToSkipTake } from '@/shared/dto';
import { OcrService } from './ocr.service';

/** Chuẩn hoá số giấy tờ trước khi mã hoá/hash (bỏ khoảng trắng, in hoa). */
function normalizeDoc(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase();
}

/** Buffer (Node) → Uint8Array<ArrayBuffer> khớp cột Prisma Bytes (cấp ArrayBuffer mới + copy). */
function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

function toDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toGuestResponse(g: guests): GuestResponse {
  return {
    id: g.id,
    full_name: g.full_name,
    phone: g.phone,
    email: g.email,
    nationality: g.nationality,
    id_document_type: g.id_document_type,
    id_document_last4: g.id_document_last4,
    id_document_masked: g.id_document_last4 ? `****${g.id_document_last4}` : null,
    id_document_issue_date: toDateOnly(g.id_document_issue_date),
    id_document_issue_place: g.id_document_issue_place,
    id_document_scan_url: g.id_document_scan_url,
    date_of_birth: toDateOnly(g.date_of_birth),
    gender: g.gender,
    address: g.address,
    notes: g.notes,
    is_blacklisted: g.is_blacklisted,
    blacklist_reason: g.blacklist_reason,
    created_at: g.created_at.toISOString(),
    updated_at: g.updated_at.toISOString(),
  };
}

@Injectable()
export class GuestsService {
  private readonly logger = new Logger(GuestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
  ) {}

  /**
   * Pre-sign upload ảnh CCCD lên storage tier VN (task 7.1, docs/12 §3). Key
   * scoped theo tenant + uuid (chưa có guest_id lúc scan): `cccd/<tnt>/<uuid>/<side>`.
   * Client PUT trực tiếp lên S3; expire 15' (mặc định presignPut). Quyền booking.create.
   */
  async presignIdScan(dto: IdScanPresignRequest, user: JwtClaims): Promise<IdScanPresignResponse> {
    const ext = dto.content_type.split('/')[1] ?? 'jpg';
    const key = `cccd/${user.tnt}/${randomUUID()}/${dto.side}.${ext}`;
    return this.storage.presignPut(key, dto.content_type);
  }

  /**
   * Scan CCCD/hộ chiếu qua OCR → trả extracted để prefill form. KHÔNG ghi DB
   * (raw response chứa PII không lưu — bản ghi gốc là ảnh trên storage). Lễ tân
   * verify/sửa rồi mới save qua create/update. OCR fail → 502/503, FE fallback nhập tay.
   */
  async scanId(dto: ScanIdRequest, user: JwtClaims): Promise<ScanIdResponse> {
    // Chỉ nhận key thuộc tenant hiện tại (chống đọc ảnh tenant khác qua key đoán).
    if (!dto.image_key.startsWith(`cccd/${user.tnt}/`)) {
      throw new AppException({ code: 'OCR_IMAGE_KEY_INVALID', title: 'Key ảnh không hợp lệ', status: 400 });
    }
    return this.ocr.scanIdDocument(dto.image_key);
  }

  async create(dto: CreateGuestRequest, user: JwtClaims): Promise<GuestResponse> {
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.guests.create({ data: this.toWriteData(dto, user.tnt) }),
    );
    return toGuestResponse(row);
  }

  /**
   * Danh sách/tìm khách: `id_document_number` → exact qua blind index (hash);
   * `q` → trgm theo tên + phone; không có → tất cả (phân trang).
   */
  async list(
    user: JwtClaims,
    query: { q?: string; id_document_number?: string; page: number; page_size: number },
  ): Promise<{ data: GuestResponse[]; page_info: OffsetPageInfo }> {
    let where: Prisma.guestsWhereInput = {};
    if (query.id_document_number) {
      where = {
        id_document_number_hash: toBytes(this.encryption.hmacIndex(normalizeDoc(query.id_document_number))),
      };
    } else if (query.q) {
      where = {
        OR: [
          { full_name: { contains: query.q, mode: 'insensitive' } },
          { phone: { contains: query.q } },
        ],
      };
    }
    const { skip, take } = offsetToSkipTake(query);

    const { rows, total } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.guests.findMany({ where, orderBy: { created_at: 'desc' }, skip, take }),
          tx.guests.count({ where }),
        ]);
        return { rows, total };
      },
      { readOnly: true },
    );

    return {
      data: rows.map(toGuestResponse),
      page_info: {
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.max(1, Math.ceil(total / query.page_size)),
      },
    };
  }

  async getById(id: string, user: JwtClaims): Promise<GuestResponse> {
    return toGuestResponse(await this.loadOrThrow(id, user));
  }

  async update(id: string, dto: UpdateGuestRequest, user: JwtClaims): Promise<GuestResponse> {
    await this.loadOrThrow(id, user);
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.guests.update({ where: { id }, data: this.toWriteData(dto, user.tnt) }),
    );
    return toGuestResponse(row);
  }

  async remove(id: string, user: JwtClaims): Promise<void> {
    await this.loadOrThrow(id, user);
    await withTenant(this.prisma, user.tnt, (tx) =>
      tx.guests.update({ where: { id }, data: { deleted_at: new Date() } }),
    );
  }

  /** ★ Xem số giấy tờ ĐẦY ĐỦ — decrypt server-side + audit READ_PII (ADR-0007 §3). */
  async getFullIdDocument(id: string, user: JwtClaims): Promise<GuestIdDocumentResponse> {
    const guest = await this.loadOrThrow(id, user);
    if (!guest.id_document_number_enc) {
      throw new AppException({
        code: 'GUEST_NO_ID_DOCUMENT',
        title: 'Khách chưa có số giấy tờ',
        status: 404,
      });
    }
    const number = this.encryption.decrypt(Buffer.from(guest.id_document_number_enc).toString('utf8'));
    // Vết kiểm toán READ_PII (task 4.5, ADR-0007 §3) — GET không qua AuditInterceptor
    // nên ghi tường minh tại đây. KHÔNG ghi số giấy tờ (chỉ ghi đã đọc field nào).
    // Log thêm cho observability/SIEM (defense-in-depth nếu audit DB write hỏng).
    this.logger.log(`READ_PII tenant=${user.tnt} actor=${user.sub} guest=${id} field=id_document_number`);
    await this.audit.record({
      tenantId: user.tnt,
      userId: user.sub,
      action: 'READ_PII',
      entityType: 'guests',
      entityId: id,
      afterData: { field: 'id_document_number' },
    });
    return { id: guest.id, id_document_type: guest.id_document_type, id_document_number: number };
  }

  async setBlacklist(
    id: string,
    blacklisted: boolean,
    user: JwtClaims,
    dto?: BlacklistGuestRequest,
  ): Promise<GuestResponse> {
    await this.loadOrThrow(id, user);
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.guests.update({
        where: { id },
        data: {
          is_blacklisted: blacklisted,
          blacklist_reason: blacklisted ? (dto?.reason ?? null) : null,
        },
      }),
    );
    return toGuestResponse(row);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async loadOrThrow(id: string, user: JwtClaims): Promise<guests> {
    const guest = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.guests.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!guest) {
      throw new AppException({ code: 'GUEST_NOT_FOUND', title: 'Khách không tồn tại', status: 404 });
    }
    return guest;
  }

  private toWriteData(
    dto: CreateGuestRequest | UpdateGuestRequest,
    tenantId: string,
  ): Prisma.guestsUncheckedCreateInput {
    const data: Prisma.guestsUncheckedCreateInput = {
      tenant_id: tenantId,
      full_name: dto.full_name as string, // create: required; update: undefined bị Prisma bỏ qua
      phone: dto.phone,
      email: dto.email,
      nationality: dto.nationality,
      id_document_type: dto.id_document_type,
      id_document_issue_date: dto.id_document_issue_date
        ? new Date(dto.id_document_issue_date)
        : undefined,
      id_document_issue_place: dto.id_document_issue_place,
      id_document_scan_url: dto.id_document_scan_url,
      date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : undefined,
      gender: dto.gender,
      address: dto.address,
      notes: dto.notes,
    };
    if (dto.id_document_number !== undefined) {
      const norm = normalizeDoc(dto.id_document_number);
      data.id_document_number_enc = toBytes(Buffer.from(this.encryption.encrypt(norm), 'utf8'));
      data.id_document_number_hash = toBytes(this.encryption.hmacIndex(norm));
      data.id_document_last4 = norm.slice(-4);
    }
    return data;
  }
}
