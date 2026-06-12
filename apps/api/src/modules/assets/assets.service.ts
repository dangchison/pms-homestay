import { Injectable, Logger } from '@nestjs/common';
import {
  type AssetResponse,
  type CreateAssetRequest,
  type DepreciationEntryResponse,
  type DepreciationRunResult,
  type DisposeAssetRequest,
  type JwtClaims,
  type OffsetPageInfo,
  type UpdateAssetRequest,
} from '@pms/shared-types';
import { roundVnd } from '@pms/pricing-engine';
import { Prisma, type assets, type depreciation_entries } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { offsetToSkipTake } from '@/shared/dto';

// ── Calendar math (UTC — cột DATE không có giờ, không phụ thuộc timezone) ─────

/** Số ngày trong tháng (month: 1–12). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Date (cột DATE) → [year, month(1-12), day]. */
function ymd(d: Date): [number, number, number] {
  const [y, m, day] = d.toISOString().slice(0, 10).split('-');
  return [Number(y), Number(m), Number(day)];
}

/** Chỉ số tháng (0-based) của kỳ (year,month) so với tháng mua; <0 = trước khi mua. */
function monthIndexOf(purchase: Date, year: number, month: number): number {
  const [py, pm] = ymd(purchase);
  return (year - py) * 12 + (month - pm);
}

/** Pro-rate tháng đầu = số ngày sở hữu (gồm ngày mua) / số ngày trong tháng. */
function firstMonthProrate(purchase: Date): number {
  const [py, pm, pd] = ymd(purchase);
  const dim = daysInMonth(py, pm);
  return (dim - pd + 1) / dim;
}

function toDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toAssetResponse(a: assets): AssetResponse {
  return {
    id: a.id,
    property_id: a.property_id,
    room_id: a.room_id,
    name: a.name,
    category: a.category,
    serial_number: a.serial_number,
    purchase_value_vnd: Number(a.purchase_value_vnd),
    purchase_date: toDateOnly(a.purchase_date)!,
    depreciation_method: a.depreciation_method,
    depreciation_months: a.depreciation_months,
    residual_value_vnd: Number(a.residual_value_vnd),
    disposal_date: toDateOnly(a.disposal_date),
    disposal_value_vnd: a.disposal_value_vnd == null ? null : Number(a.disposal_value_vnd),
    notes: a.notes,
    photo_url: a.photo_url,
    created_at: a.created_at.toISOString(),
    updated_at: a.updated_at.toISOString(),
  };
}

function toEntryResponse(e: depreciation_entries): DepreciationEntryResponse {
  return {
    id: e.id,
    asset_id: e.asset_id,
    period_year: e.period_year,
    period_month: e.period_month,
    amount_vnd: Number(e.amount_vnd),
    accumulated_vnd: Number(e.accumulated_vnd),
    book_value_vnd: Number(e.book_value_vnd),
    created_at: e.created_at.toISOString(),
  };
}

/**
 * Tài sản cố định + khấu hao (task 3.5, docs/09 §7). Property-scoped:
 * pha-1 RBAC `asset.crud` (controller) + pha-2 `authorizeOnProperty` (đây).
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
  ) {}

  async create(dto: CreateAssetRequest, user: JwtClaims): Promise<AssetResponse> {
    await this.assertPropertyExists(dto.property_id, user);
    await this.permissionService.authorizeOnProperty(user, dto.property_id, 'asset.crud');

    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.assets.create({
        data: {
          tenant_id: user.tnt,
          property_id: dto.property_id,
          room_id: dto.room_id ?? null,
          name: dto.name,
          category: dto.category,
          serial_number: dto.serial_number,
          purchase_value_vnd: dto.purchase_value_vnd,
          purchase_date: new Date(dto.purchase_date),
          depreciation_method: dto.depreciation_method,
          depreciation_months: dto.depreciation_months,
          residual_value_vnd: dto.residual_value_vnd,
          notes: dto.notes,
          photo_url: dto.photo_url,
        } satisfies Prisma.assetsUncheckedCreateInput,
      }),
    );
    return toAssetResponse(row);
  }

  async list(
    propertyId: string,
    user: JwtClaims,
    query: { page: number; page_size: number },
  ): Promise<{ data: AssetResponse[]; page_info: OffsetPageInfo }> {
    await this.assertPropertyExists(propertyId, user);
    await this.permissionService.authorizeOnProperty(user, propertyId, 'asset.crud');
    const { skip, take } = offsetToSkipTake(query);

    const { rows, total } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.assets.findMany({
            where: { property_id: propertyId },
            orderBy: { created_at: 'desc' },
            skip,
            take,
          }),
          tx.assets.count({ where: { property_id: propertyId } }),
        ]);
        return { rows, total };
      },
      { readOnly: true },
    );

    return {
      data: rows.map(toAssetResponse),
      page_info: {
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.max(1, Math.ceil(total / query.page_size)),
      },
    };
  }

  async getById(id: string, user: JwtClaims): Promise<AssetResponse> {
    const asset = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, asset.property_id, 'asset.crud');
    return toAssetResponse(asset);
  }

  /** PATCH — chỉ trường mô tả (tham số tài chính bất biến sau khi tạo). */
  async update(id: string, dto: UpdateAssetRequest, user: JwtClaims): Promise<AssetResponse> {
    const asset = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, asset.property_id, 'asset.crud');
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.assets.update({
        where: { id },
        data: {
          room_id: dto.room_id,
          name: dto.name,
          category: dto.category,
          serial_number: dto.serial_number,
          notes: dto.notes,
          photo_url: dto.photo_url,
        } satisfies Prisma.assetsUncheckedUpdateInput,
      }),
    );
    return toAssetResponse(row);
  }

  async remove(id: string, user: JwtClaims): Promise<void> {
    const asset = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, asset.property_id, 'asset.crud');
    await withTenant(this.prisma, user.tnt, (tx) =>
      tx.assets.update({ where: { id }, data: { deleted_at: new Date() } }),
    );
  }

  /** Thanh lý: ghi disposal_date/value → cron khấu hao bỏ qua từ kỳ sau (docs/09 §7). */
  async dispose(id: string, dto: DisposeAssetRequest, user: JwtClaims): Promise<AssetResponse> {
    const asset = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, asset.property_id, 'asset.crud');
    if (asset.disposal_date) {
      throw new AppException({
        code: 'ASSET_ALREADY_DISPOSED',
        title: 'Tài sản đã được thanh lý',
        status: 409,
      });
    }
    if (dto.disposal_date < toDateOnly(asset.purchase_date)!) {
      throw new AppException({
        code: 'ASSET_DISPOSAL_BEFORE_PURCHASE',
        title: 'Ngày thanh lý không thể trước ngày mua',
        status: 422,
      });
    }
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.assets.update({
        where: { id },
        data: {
          disposal_date: new Date(dto.disposal_date),
          disposal_value_vnd: dto.disposal_value_vnd,
        },
      }),
    );
    return toAssetResponse(row);
  }

  async listDepreciation(id: string, user: JwtClaims): Promise<DepreciationEntryResponse[]> {
    const asset = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, asset.property_id, 'asset.crud');
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.depreciation_entries.findMany({
          where: { asset_id: id },
          orderBy: [{ period_year: 'asc' }, { period_month: 'asc' }],
        }),
      { readOnly: true },
    );
    return rows.map(toEntryResponse);
  }

  /**
   * ★ Khấu hao tháng (docs/09 §7) — gọi từ night-audit 4.6 (per tenant ACTIVE,
   * ngày 1 hằng tháng). Chống N+1 (1 query luỹ kế), pro-rate tháng đầu, THÁNG
   * CUỐI = plug số dư (accumulated == nguyên giá − residual, triệt tiêu lệch làm
   * tròn từng tháng), bỏ qua tài sản đã thanh lý. `createMany skipDuplicates` →
   * chạy lại cùng kỳ KHÔNG sinh đôi (idempotent, nhờ UNIQUE asset+kỳ).
   */
  async runMonthlyDepreciation(
    tenantId: string,
    year: number,
    month: number,
  ): Promise<DepreciationRunResult> {
    const periodEnd = new Date(Date.UTC(year, month - 1, daysInMonth(year, month)));

    return withTenant(this.prisma, tenantId, async (tx) => {
      const assetsList = await tx.assets.findMany({
        where: {
          purchase_date: { lte: periodEnd },
          OR: [{ disposal_date: null }, { disposal_date: { gt: periodEnd } }],
        },
      });

      // Luỹ kế hiện có của TẤT CẢ asset trong 1 query (chống N+1).
      const grouped =
        assetsList.length === 0
          ? []
          : await tx.depreciation_entries.groupBy({
              by: ['asset_id'],
              where: { asset_id: { in: assetsList.map((a) => a.id) } },
              _sum: { amount_vnd: true },
              orderBy: { asset_id: 'asc' },
            });
      const accMap = new Map<string, number>(
        grouped.map((g) => [g.asset_id, Number(g._sum.amount_vnd ?? 0)]),
      );

      const entries: Prisma.depreciation_entriesCreateManyInput[] = [];
      for (const asset of assetsList) {
        const idx = monthIndexOf(asset.purchase_date, year, month);
        if (idx < 0 || idx >= asset.depreciation_months) continue;

        const base = Number(asset.purchase_value_vnd) - Number(asset.residual_value_vnd);
        const acc = accMap.get(asset.id) ?? 0;
        let amount: number;
        if (idx === asset.depreciation_months - 1) {
          amount = base - acc; // ★ plug tháng cuối — khoá accumulated == base
        } else {
          const prorate = idx === 0 ? firstMonthProrate(asset.purchase_date) : 1;
          amount = roundVnd((base / asset.depreciation_months) * prorate);
        }
        const accumulated = acc + amount;
        entries.push({
          tenant_id: tenantId,
          asset_id: asset.id,
          period_year: year,
          period_month: month,
          amount_vnd: amount,
          accumulated_vnd: accumulated,
          book_value_vnd: Number(asset.purchase_value_vnd) - accumulated,
        });
      }

      const created =
        entries.length === 0
          ? { count: 0 }
          : await tx.depreciation_entries.createMany({ data: entries, skipDuplicates: true });

      if (created.count > 0) {
        this.logger.log(
          `Khấu hao ${year}-${String(month).padStart(2, '0')}: ${created.count} dòng (tenant ${tenantId})`,
        );
      }
      return {
        period_year: year,
        period_month: month,
        assets_considered: assetsList.length,
        entries_created: created.count,
      };
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertPropertyExists(propertyId: string, user: JwtClaims): Promise<void> {
    const prop = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.properties.findFirst({ where: { id: propertyId }, select: { id: true } }),
      { readOnly: true },
    );
    if (!prop) {
      throw new AppException({
        code: 'PROPERTY_NOT_FOUND',
        title: 'Cơ sở không tồn tại',
        status: 404,
      });
    }
  }

  private async loadOrThrow(id: string, user: JwtClaims): Promise<assets> {
    const asset = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.assets.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!asset) {
      throw new AppException({ code: 'ASSET_NOT_FOUND', title: 'Tài sản không tồn tại', status: 404 });
    }
    return asset;
  }
}
