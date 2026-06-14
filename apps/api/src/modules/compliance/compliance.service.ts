import { Injectable, Logger } from '@nestjs/common';
import { type JwtClaims, type PoliceReportQuery } from '@pms/shared-types';
import { AuditService } from '@modules/audit/audit.service';
import { PermissionService } from '@core/auth/permission.service';
import { EncryptionService } from '@core/crypto/encryption.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { type PoliceReportRow, buildPoliceReportWorkbook } from './police-report.builder';

function toDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export interface PoliceReportResult {
  buffer: Buffer;
  filename: string;
  count: number;
}

/**
 * Báo cáo lưu trú công an (Thông tư 56) — task 7.2, docs/12 §2. Lọc booking đã
 * lưu trú (CHECKED_IN/CHECKED_OUT) có check_in trong [from, to] tại property, join
 * guest, **giải mã số giấy tờ theo BATCH** (1 lần đọc) rồi ghi **1 audit READ_PII**
 * scope "police-report" (KHÔNG log từng số — ADR-0007 §3). Trả Buffer .xlsx.
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
  ) {}

  async generatePoliceReport(query: PoliceReportQuery, user: JwtClaims): Promise<PoliceReportResult> {
    await this.assertPropertyExists(query.property_id, user);
    // Pha-2: property-scope (PII nhạy cảm) — propertyId từ query, OWNER pass toàn tenant.
    await this.permissionService.authorizeOnProperty(user, query.property_id, 'guest.pii.read');

    const fromStart = new Date(`${query.from}T00:00:00.000Z`);
    const toEnd = new Date(`${query.to}T23:59:59.999Z`);

    const { propertyName, bookings } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const prop = await tx.properties.findFirst({
          where: { id: query.property_id },
          select: { name: true },
        });
        const rows = await tx.bookings.findMany({
          where: {
            property_id: query.property_id,
            status: { in: ['CHECKED_IN', 'CHECKED_OUT'] },
            check_in: { gte: fromStart, lte: toEnd },
            guest_id: { not: null },
          },
          include: { guests: true },
          orderBy: { check_in: 'asc' },
        });
        return { propertyName: prop?.name ?? '', bookings: rows };
      },
      { readOnly: true },
    );

    // Giải mã số giấy tờ theo batch (mỗi guest 1 lần; lỗi 1 dòng → null, không vỡ cả report).
    const rows: PoliceReportRow[] = bookings.map((b) => {
      const g = b.guests!;
      let number: string | null = null;
      if (g.id_document_number_enc) {
        try {
          number = this.encryption.decrypt(Buffer.from(g.id_document_number_enc).toString('utf8'));
        } catch (err) {
          this.logger.warn(`Giải mã số giấy tờ guest=${g.id} lỗi: ${String(err)}`);
        }
      }
      return {
        full_name: g.full_name,
        date_of_birth: toDateOnly(g.date_of_birth),
        gender: g.gender,
        nationality: g.nationality,
        id_document_type: g.id_document_type,
        id_document_number: number,
        id_document_issue_date: toDateOnly(g.id_document_issue_date),
        id_document_issue_place: g.id_document_issue_place,
        address: g.address,
        phone: g.phone,
        check_in: b.check_in.toISOString(),
        check_out: b.check_out.toISOString(),
        booking_code: b.booking_code,
      };
    });

    // 1 vết READ_PII cho cả report (không log từng số giấy tờ).
    await this.audit.record({
      tenantId: user.tnt,
      userId: user.sub,
      action: 'READ_PII',
      entityType: 'police-report',
      entityId: query.property_id,
      afterData: {
        scope: 'police-report',
        property_id: query.property_id,
        from: query.from,
        to: query.to,
        guest_count: rows.length,
      },
    });

    const buffer = await buildPoliceReportWorkbook(rows, {
      property_name: propertyName,
      from: query.from,
      to: query.to,
    });
    return { buffer, filename: `police-report-${query.from}_${query.to}.xlsx`, count: rows.length };
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
}
