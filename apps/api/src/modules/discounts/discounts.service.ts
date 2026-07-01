import { Injectable } from '@nestjs/common';
import {
  type ApplyDiscountResult,
  type CreateDiscountCodeRequest,
  type DiscountCodeResponse,
  type DiscountType,
  type JwtClaims,
  refineDiscountValue,
  type UpdateDiscountCodeRequest,
} from '@pms/shared-types';
import { roundVnd } from '@pms/pricing-engine';
import { Prisma } from '@prisma/client';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';

type Tx = Prisma.TransactionClient;

/** Basis-point mẫu số cho PERCENT (10000 = 100%) — cùng quy ước rate_plan_rules & landlord_revenue_share_bp. */
const PERCENT_BP_DIVISOR = 10_000;

/**
 * Row discount_codes ĐỌC QUA $queryRaw (KHÔNG dùng model typed của Prisma).
 * LÝ DO BẮT BUỘC: Prisma Client KHÔNG phân biệt được cột mảng NULL với mảng rỗng
 * — model typed luôn trả `[]` cho cả `NULL` lẫn `{}` (giới hạn Prisma). Mà semantic
 * voucher YÊU CẦU: applicable_property_ids NULL = MỌI property, [] = KHÔNG property nào.
 * Driver pg (qua $queryRaw) giữ đúng `null` vs `[]` → đọc raw để không mất NULL.
 * Money (BigInt cột) đọc ra BigInt; used_count/max_uses là INT (number).
 */
interface DiscountRow {
  id: string;
  code: string;
  discount_type: DiscountType;
  discount_value: bigint;
  min_order_vnd: bigint;
  max_uses: number | null;
  used_count: number;
  valid_from: Date | null;
  valid_to: Date | null;
  applicable_property_ids: string[] | null; // null (mọi property) KHÁC [] (không property nào)
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** SELECT chuẩn (giữ NULL của applicable_property_ids). Chỉ đọc mã LIVE (deleted_at IS NULL). */
const SELECT_LIVE = (whereMore: Prisma.Sql): Prisma.Sql => Prisma.sql`
  SELECT id::text AS id, code, discount_type::text AS discount_type,
         discount_value, min_order_vnd, max_uses, used_count,
         valid_from, valid_to, applicable_property_ids, is_active, created_at, updated_at
  FROM discount_codes
  WHERE deleted_at IS NULL ${whereMore}
`;

/** Ngữ cảnh áp mã cho 1 báo giá — subtotal (BigInt VND) + property của quote/booking + thời điểm. */
export interface ApplyDiscountContext {
  subtotalVnd: bigint;
  propertyId: string;
  now?: Date;
}

/**
 * Ánh xạ row → Response (KHÔNG lộ tenant_id/deleted_at; money BigInt→number; thời điểm → ISO).
 * applicable_property_ids: giữ nguyên null vs [] (KHÔNG coalesce — phân biệt là bất biến).
 */
function toResponse(row: DiscountRow): DiscountCodeResponse {
  return {
    id: row.id,
    code: row.code,
    discount_type: row.discount_type,
    discount_value: Number(row.discount_value),
    min_order_vnd: Number(row.min_order_vnd),
    max_uses: row.max_uses,
    used_count: row.used_count,
    valid_from: row.valid_from ? row.valid_from.toISOString() : null,
    valid_to: row.valid_to ? row.valid_to.toISOString() : null,
    applicable_property_ids: row.applicable_property_ids,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Kết quả fail dùng chung (valid:false, discount 0). */
function fail(reason_code: ApplyDiscountResult['reason_code']): ApplyDiscountResult {
  return { valid: false, discount_vnd: 0, reason_code };
}

/**
 * Mã giảm giá / khuyến mãi (discount_codes) — Wave-1 #4, task 9.4b, docs/07 §7.
 *
 * Ba trách nhiệm:
 *  1. CRUD mã (tenant-scoped qua withTenant; soft-delete; trùng CITEXT → 409).
 *  2. applyDiscount — logic THUẦN quyết định giảm bao nhiêu + reason_code cho báo giá
 *     (FIXED cap theo subtotal; PERCENT dùng roundVnd basis-point /10000; closed-interval
 *     valid window; applicable_property_ids NULL=mọi property KHÁC []=không property nào).
 *  3. redeemInTx — tăng used_count ATOMIC trong tx booking (UPDATE...WHERE used_count<max_uses
 *     RETURNING trong 1 câu, chống double-spend); 0 hàng → DISCOUNT_EXHAUSTED 409 → rollback booking.
 *
 * Money đọc/ghi BigInt ở tầng service, tính qua roundVnd; KHÔNG external I/O trong withTenant/tx.
 * KHÔNG PII (voucher finance-like) → không audit bắt buộc. Đọc mã qua $queryRaw để giữ NULL
 * của applicable_property_ids (giới hạn Prisma với cột mảng — xem DiscountRow).
 */
@Injectable()
export class DiscountsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  /** Tạo mã (Zod refine PERCENT 0..10000 / FIXED>=1 đã chạy ở DTO). Trùng code live (CITEXT) → 409. */
  async create(dto: CreateDiscountCodeRequest, user: JwtClaims): Promise<DiscountCodeResponse> {
    const row = await withTenant(this.prisma, user.tnt, async (tx) => {
      await this.assertCodeUnique(tx, dto.code);
      const created = await tx.discount_codes.create({
        data: {
          tenant_id: user.tnt,
          code: dto.code,
          discount_type: dto.discount_type,
          discount_value: BigInt(dto.discount_value),
          min_order_vnd: dto.min_order_vnd === undefined ? undefined : BigInt(dto.min_order_vnd),
          max_uses: dto.max_uses ?? null,
          valid_from: dto.valid_from ? new Date(dto.valid_from) : null,
          valid_to: dto.valid_to ? new Date(dto.valid_to) : null,
          // undefined = giữ default DB (NULL = mọi property). [] (mảng rỗng) ghi đúng [] (không property).
          applicable_property_ids: dto.applicable_property_ids ?? undefined,
          is_active: dto.is_active,
        },
        select: { id: true },
      });
      return this.findRawByIdOrThrow(tx, created.id);
    });
    return toResponse(row);
  }

  /** Liệt kê mã LIVE của tenant (ẩn mã đã soft-delete). */
  async list(user: JwtClaims): Promise<DiscountCodeResponse[]> {
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.$queryRaw<DiscountRow[]>(SELECT_LIVE(Prisma.sql`ORDER BY created_at DESC`)),
      { readOnly: true },
    );
    return rows.map(toResponse);
  }

  async getById(id: string, user: JwtClaims): Promise<DiscountCodeResponse> {
    const row = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => this.findRawById(tx, id),
      { readOnly: true },
    );
    if (!row) throw this.notFound();
    return toResponse(row);
  }

  /** Cập nhật mã. Đổi code → kiểm trùng live (CITEXT). refine PERCENT/FIXED cross-field ở DTO. */
  async update(
    id: string,
    dto: UpdateDiscountCodeRequest,
    user: JwtClaims,
  ): Promise<DiscountCodeResponse> {
    const row = await withTenant(this.prisma, user.tnt, async (tx) => {
      const existing = await this.findRawById(tx, id);
      if (!existing) throw this.notFound();
      if (dto.code !== undefined && dto.code.toLowerCase() !== existing.code.toLowerCase()) {
        await this.assertCodeUnique(tx, dto.code);
      }
      // Cross-field PERCENT/FIXED: DTO refine cố tình bỏ qua khi CHỈ đổi một trong hai
      // (discount-code.ts) → service merge với bản ghi hiện có & kiểm chéo (như
      // rate-plans.assertEffectiveWindow). Ngăn cặp lệch lọt qua → DB CHECK 23514 → 500.
      this.assertValueByType(dto, existing);
      await tx.discount_codes.update({
        where: { id },
        data: {
          code: dto.code,
          discount_type: dto.discount_type,
          discount_value:
            dto.discount_value === undefined ? undefined : BigInt(dto.discount_value),
          min_order_vnd:
            dto.min_order_vnd === undefined ? undefined : BigInt(dto.min_order_vnd),
          max_uses: dto.max_uses,
          valid_from:
            dto.valid_from === undefined
              ? undefined
              : dto.valid_from === null
                ? null
                : new Date(dto.valid_from),
          valid_to:
            dto.valid_to === undefined
              ? undefined
              : dto.valid_to === null
                ? null
                : new Date(dto.valid_to),
          applicable_property_ids: dto.applicable_property_ids ?? undefined,
          is_active: dto.is_active,
        },
      });
      return this.findRawByIdOrThrow(tx, id);
    });
    return toResponse(row);
  }

  /** Xoá MỀM (deleted_at) — mã biến khỏi list & applyDiscount trả NOT_FOUND. */
  async remove(id: string, user: JwtClaims): Promise<void> {
    await withTenant(this.prisma, user.tnt, async (tx) => {
      const existing = await this.findRawById(tx, id);
      if (!existing) throw this.notFound();
      await tx.discount_codes.update({ where: { id }, data: { deleted_at: new Date() } });
    });
  }

  // ── Áp mã (logic thuần) ───────────────────────────────────────────────────

  /**
   * Áp mã lên báo giá theo CODE (chuỗi, CITEXT) — load row LIVE (raw, giữ NULL) rồi ủy cho
   * evaluate. now mặc định = thời điểm gọi. Ở 9.4b đây là scaffolding (chỉ e2e gọi trực
   * tiếp qua service); endpoint validate & luồng populate discount_code_id SẼ wiring ở 9.4c.
   */
  async applyDiscount(
    code: string,
    ctx: ApplyDiscountContext,
    user: JwtClaims,
  ): Promise<ApplyDiscountResult> {
    const row = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const rows = await tx.$queryRaw<DiscountRow[]>(
          SELECT_LIVE(Prisma.sql`AND code = ${code}::citext`),
        );
        return rows[0] ?? null;
      },
      { readOnly: true },
    );
    return DiscountsService.evaluate(row, ctx);
  }

  /**
   * ★ Lõi quyết định — THUẦN (không I/O). row = null (không tồn tại/đã soft-delete) → NOT_FOUND.
   * Thứ tự nhánh fail: INACTIVE → NOT_STARTED → EXPIRED → BELOW_MIN_ORDER → PROPERTY_NOT_ELIGIBLE
   * → USAGE_LIMIT_REACHED → OK. FIXED: min(discount_value, subtotal) (cap, không âm total).
   * PERCENT: roundVnd(subtotal * value / 10000) (basis-point, half-away-from-zero) — KHÔNG Math.round.
   */
  static evaluate(row: DiscountRow | null, ctx: ApplyDiscountContext): ApplyDiscountResult {
    if (!row) return fail('NOT_FOUND');
    if (!row.is_active) return fail('INACTIVE');

    const now = ctx.now ?? new Date();
    // closed interval: now == valid_from và now == valid_to đều hợp lệ.
    if (row.valid_from && now.getTime() < row.valid_from.getTime()) return fail('NOT_STARTED');
    if (row.valid_to && now.getTime() > row.valid_to.getTime()) return fail('EXPIRED');

    if (ctx.subtotalVnd < row.min_order_vnd) return fail('BELOW_MIN_ORDER');

    // applicable_property_ids: NULL = MỌI property; [] = KHÔNG property nào (phân biệt tường minh).
    if (row.applicable_property_ids !== null && !row.applicable_property_ids.includes(ctx.propertyId)) {
      return fail('PROPERTY_NOT_ELIGIBLE');
    }

    if (row.max_uses !== null && row.used_count >= row.max_uses) return fail('USAGE_LIMIT_REACHED');

    const discountVnd =
      row.discount_type === 'FIXED'
        ? Number(row.discount_value < ctx.subtotalVnd ? row.discount_value : ctx.subtotalVnd)
        : roundVnd((Number(ctx.subtotalVnd) * Number(row.discount_value)) / PERCENT_BP_DIVISOR);

    return { valid: true, discount_vnd: discountVnd, reason_code: 'OK' };
  }

  // ── Redemption (atomic, trong tx booking) ──────────────────────────────────

  /**
   * ★ Tăng used_count ATOMIC — gọi TRONG tx booking (createBookingTx) khi
   * quote.discount_code_id != NULL. UPDATE có điều kiện trong 1 câu:
   *   WHERE id = $ AND tenant_id = $ AND (max_uses IS NULL OR used_count < max_uses)
   *         AND is_active AND deleted_at IS NULL
   *   RETURNING id, used_count
   * → chống double-spend đồng thời (2 booking cùng mã cuối): chỉ 1 câu thắng, câu kia
   * 0 hàng ⇒ ném DISCOUNT_EXHAUSTED 409 ⇒ rollback CẢ booking (không booking mồ côi).
   * max_uses = NULL → tăng không giới hạn, không bao giờ ném. Mã đã tắt/xoá mềm cũng 409.
   */
  async redeemInTx(
    tx: Tx,
    tenantId: string,
    discountCodeId: string,
  ): Promise<{ id: string; used_count: number }> {
    const rows = await tx.$queryRaw<{ id: string; used_count: number }[]>(Prisma.sql`
      UPDATE discount_codes
      SET used_count = used_count + 1
      WHERE id = ${discountCodeId}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND (max_uses IS NULL OR used_count < max_uses)
        AND is_active
        AND deleted_at IS NULL
      RETURNING id::text AS id, used_count
    `);
    const row = rows[0];
    if (!row) {
      throw new AppException({
        code: 'DISCOUNT_EXHAUSTED',
        title: 'Mã giảm giá đã hết lượt dùng hoặc không còn hiệu lực',
        status: 409,
      });
    }
    return row;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Kiểm chéo PERCENT/FIXED trên GIÁ TRỊ HIỆU LỰC (merge dto ?? existing) — chạy khi
   * update() đổi discount_type HOẶC discount_value (DTO refine cố tình bỏ qua nhánh
   * đơn-lẻ, ủy cho service — xem discount-code.ts §Update). Cùng phong cách
   * rate-plans.assertEffectiveWindow: lệch → 422 (KHÔNG để DB CHECK 23514 nổi 500).
   */
  private assertValueByType(dto: UpdateDiscountCodeRequest, existing: DiscountRow): void {
    if (dto.discount_type === undefined && dto.discount_value === undefined) return;
    const effectiveType = dto.discount_type ?? existing.discount_type;
    const effectiveValue = dto.discount_value ?? Number(existing.discount_value);
    if (!refineDiscountValue({ discount_type: effectiveType, discount_value: effectiveValue })) {
      throw new AppException({
        code: 'DISCOUNT_VALUE_INVALID',
        title: 'PERCENT: discount_value trong 0..10000 (basis-point); FIXED: ≥ 1 (VND)',
        status: 422,
        fields: [
          {
            field: 'discount_value',
            code: 'DISCOUNT_VALUE_INVALID',
            message: 'không hợp lệ cho discount_type',
          },
        ],
      });
    }
  }

  /** Trùng code LIVE (CITEXT, chưa soft-delete) trong tenant → 409. */
  private async assertCodeUnique(tx: Tx, code: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM discount_codes WHERE code = ${code}::citext AND deleted_at IS NULL LIMIT 1
    `);
    if (rows.length > 0) {
      throw new AppException({
        code: 'DISCOUNT_CODE_DUPLICATE',
        title: 'Mã giảm giá đã tồn tại',
        status: 409,
      });
    }
  }

  /** Đọc 1 mã LIVE theo id (raw, giữ NULL applicable_property_ids). null nếu không có/đã soft-delete. */
  private async findRawById(tx: Tx, id: string): Promise<DiscountRow | null> {
    const rows = await tx.$queryRaw<DiscountRow[]>(SELECT_LIVE(Prisma.sql`AND id = ${id}::uuid`));
    return rows[0] ?? null;
  }

  private async findRawByIdOrThrow(tx: Tx, id: string): Promise<DiscountRow> {
    const row = await this.findRawById(tx, id);
    if (!row) throw this.notFound();
    return row;
  }

  private notFound(): AppException {
    return new AppException({
      code: 'DISCOUNT_CODE_NOT_FOUND',
      title: 'Mã giảm giá không tồn tại',
      status: 404,
    });
  }
}
