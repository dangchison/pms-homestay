import { Injectable, Logger } from '@nestjs/common';
import {
  type CreateExpenseRequest,
  type ExpenseResponse,
  type JwtClaims,
  type OffsetPageInfo,
  type RecurringExpenseRunResult,
  type UpdateExpenseRequest,
} from '@pms/shared-types';
import { Prisma, type operational_expenses } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { offsetToSkipTake } from '@/shared/dto';

type Tx = Prisma.TransactionClient;

/** Booking tối thiểu cho auto-sinh hoa hồng OTA (gọi từ BookingsService.checkOut). */
export interface BookingForExpense {
  id: string;
  tenant_id: string;
  property_id: string;
  commission_vnd: bigint;
  booking_code: string;
}

// ── Calendar math (UTC — cột DATE không có giờ) ──────────────────────────────

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Date (cột DATE) → [year, month(1-12), day]. */
function ymd(d: Date): [number, number, number] {
  const [y, m, day] = d.toISOString().slice(0, 10).split('-');
  return [Number(y), Number(m), Number(day)];
}

/**
 * Template định kỳ có "khai hoả" trong kỳ (year,month) không? idx = số tháng từ
 * tháng neo (expense_date của template). idx≤0 = chính tháng neo (template đã là
 * chi phí của nó) → bỏ. MONTHLY mọi tháng; QUARTERLY mỗi 3; YEARLY mỗi 12.
 */
function firesInPeriod(anchor: Date, pattern: string | null, year: number, month: number): boolean {
  const [ay, am] = ymd(anchor);
  const idx = (year - ay) * 12 + (month - am);
  if (idx <= 0) return false;
  switch (pattern) {
    case 'MONTHLY':
      return true;
    case 'QUARTERLY':
      return idx % 3 === 0;
    case 'YEARLY':
      return idx % 12 === 0;
    default:
      return false;
  }
}

function toDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toExpenseResponse(e: operational_expenses): ExpenseResponse {
  return {
    id: e.id,
    property_id: e.property_id,
    room_id: e.room_id,
    expense_type: e.expense_type,
    description: e.description,
    amount_vnd: Number(e.amount_vnd),
    expense_date: toDateOnly(e.expense_date)!,
    due_date: toDateOnly(e.due_date),
    is_recurring: e.is_recurring,
    recurrence_pattern: e.recurrence_pattern,
    parent_expense_id: e.parent_expense_id,
    source_booking_id: e.source_booking_id,
    is_paid: e.is_paid,
    paid_at: e.paid_at ? e.paid_at.toISOString() : null,
    receipt_url: e.receipt_url,
    created_at: e.created_at.toISOString(),
    updated_at: e.updated_at.toISOString(),
  };
}

/**
 * Chi phí vận hành + hoa hồng OTA (task 3.6, docs/09 §6). Property-scoped:
 * pha-1 RBAC `expense.crud` (controller) + pha-2 `authorizeOnProperty` (đây).
 */
@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
  ) {}

  async create(dto: CreateExpenseRequest, user: JwtClaims): Promise<ExpenseResponse> {
    await this.assertPropertyExists(dto.property_id, user);
    await this.permissionService.authorizeOnProperty(user, dto.property_id, 'expense.crud');

    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.operational_expenses.create({
        data: {
          tenant_id: user.tnt,
          property_id: dto.property_id,
          room_id: dto.room_id ?? null,
          expense_type: dto.expense_type,
          description: dto.description,
          amount_vnd: dto.amount_vnd,
          expense_date: new Date(dto.expense_date),
          due_date: dto.due_date ? new Date(dto.due_date) : undefined,
          is_recurring: dto.is_recurring,
          recurrence_pattern: dto.recurrence_pattern,
          is_paid: dto.is_paid,
          paid_at: dto.paid_at ? new Date(dto.paid_at) : undefined,
          receipt_url: dto.receipt_url,
          created_by: user.sub,
        } satisfies Prisma.operational_expensesUncheckedCreateInput,
      }),
    );
    return toExpenseResponse(row);
  }

  async list(
    propertyId: string,
    user: JwtClaims,
    query: { expense_type?: string; from?: string; to?: string; page: number; page_size: number },
  ): Promise<{ data: ExpenseResponse[]; page_info: OffsetPageInfo }> {
    await this.assertPropertyExists(propertyId, user);
    await this.permissionService.authorizeOnProperty(user, propertyId, 'expense.crud');

    const where: Prisma.operational_expensesWhereInput = { property_id: propertyId };
    if (query.expense_type) where.expense_type = query.expense_type;
    if (query.from || query.to) {
      where.expense_date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const { skip, take } = offsetToSkipTake(query);

    const { rows, total } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.operational_expenses.findMany({ where, orderBy: { expense_date: 'desc' }, skip, take }),
          tx.operational_expenses.count({ where }),
        ]);
        return { rows, total };
      },
      { readOnly: true },
    );

    return {
      data: rows.map(toExpenseResponse),
      page_info: {
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.max(1, Math.ceil(total / query.page_size)),
      },
    };
  }

  async getById(id: string, user: JwtClaims): Promise<ExpenseResponse> {
    const exp = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, exp.property_id, 'expense.crud');
    return toExpenseResponse(exp);
  }

  async update(id: string, dto: UpdateExpenseRequest, user: JwtClaims): Promise<ExpenseResponse> {
    const exp = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, exp.property_id, 'expense.crud');
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.operational_expenses.update({
        where: { id },
        data: {
          room_id: dto.room_id,
          description: dto.description,
          amount_vnd: dto.amount_vnd,
          expense_date: dto.expense_date ? new Date(dto.expense_date) : undefined,
          due_date: dto.due_date === undefined ? undefined : dto.due_date ? new Date(dto.due_date) : null,
          is_paid: dto.is_paid,
          paid_at: dto.paid_at === undefined ? undefined : dto.paid_at ? new Date(dto.paid_at) : null,
          receipt_url: dto.receipt_url,
        } satisfies Prisma.operational_expensesUncheckedUpdateInput,
      }),
    );
    return toExpenseResponse(row);
  }

  /** Xoá cứng (không soft-delete); chặn xoá template còn dòng con định kỳ. */
  async remove(id: string, user: JwtClaims): Promise<void> {
    const exp = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, exp.property_id, 'expense.crud');
    await withTenant(this.prisma, user.tnt, async (tx) => {
      const children = await tx.operational_expenses.count({ where: { parent_expense_id: id } });
      if (children > 0) {
        throw new AppException({
          code: 'EXPENSE_HAS_CHILDREN',
          title: 'Chi phí định kỳ còn dòng con — không thể xoá',
          status: 409,
        });
      }
      await tx.operational_expenses.delete({ where: { id } });
    });
  }

  /**
   * ★ Auto-sinh hoa hồng OTA khi booking CHECKED_OUT (docs/09 §6) — gọi TRONG tx
   * check-out của BookingsService. `commission_vnd <= 0` → bỏ qua. Idempotent nhờ
   * partial unique `uq_expense_ota_commission` (1 dòng/booking) + skipDuplicates.
   * P&L đọc hoa hồng DUY NHẤT từ bảng này (không cộng bookings.commission_vnd nữa).
   */
  async createOtaCommissionForBooking(tx: Tx, booking: BookingForExpense): Promise<void> {
    const commission = Number(booking.commission_vnd);
    if (commission <= 0) return;
    await tx.operational_expenses.createMany({
      data: [
        {
          tenant_id: booking.tenant_id,
          property_id: booking.property_id,
          expense_type: 'OTA_COMMISSION',
          description: `Hoa hồng OTA — booking ${booking.booking_code}`,
          amount_vnd: commission,
          expense_date: new Date(), // ngày check-out
          source_booking_id: booking.id,
        },
      ],
      skipDuplicates: true,
    });
  }

  /**
   * Sinh chi phí định kỳ cho kỳ (year, month) từ template (`is_recurring=true`) —
   * gọi từ night-audit 4.6 ngày 1 hằng tháng, per tenant. Idempotent: bỏ qua
   * template đã có dòng con trong kỳ. Child `is_recurring=false`, `parent_expense_id`
   * trỏ template; ngày = ngày-trong-tháng của template (kẹp cuối tháng).
   */
  async generateRecurringExpenses(
    tenantId: string,
    year: number,
    month: number,
  ): Promise<RecurringExpenseRunResult> {
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month - 1, daysInMonth(year, month)));

    return withTenant(this.prisma, tenantId, async (tx) => {
      const templates = await tx.operational_expenses.findMany({
        where: { is_recurring: true, parent_expense_id: null, expense_date: { lte: periodEnd } },
      });

      // Template đã sinh dòng con trong kỳ này → bỏ (idempotent re-run).
      const existing =
        templates.length === 0
          ? []
          : await tx.operational_expenses.findMany({
              where: {
                parent_expense_id: { in: templates.map((t) => t.id) },
                expense_date: { gte: periodStart, lte: periodEnd },
              },
              select: { parent_expense_id: true },
            });
      const alreadyDone = new Set(existing.map((e) => e.parent_expense_id));

      const rows: Prisma.operational_expensesCreateManyInput[] = [];
      for (const t of templates) {
        if (alreadyDone.has(t.id)) continue;
        if (!firesInPeriod(t.expense_date, t.recurrence_pattern, year, month)) continue;
        const day = Math.min(ymd(t.expense_date)[2], daysInMonth(year, month));
        rows.push({
          tenant_id: tenantId,
          property_id: t.property_id,
          room_id: t.room_id,
          expense_type: t.expense_type,
          description: t.description,
          amount_vnd: t.amount_vnd,
          expense_date: new Date(Date.UTC(year, month - 1, day)),
          is_recurring: false,
          parent_expense_id: t.id,
          created_by: t.created_by,
        });
      }

      const created = rows.length === 0 ? { count: 0 } : await tx.operational_expenses.createMany({ data: rows });
      if (created.count > 0) {
        this.logger.log(
          `Chi phí định kỳ ${year}-${String(month).padStart(2, '0')}: ${created.count} dòng (tenant ${tenantId})`,
        );
      }
      return {
        period_year: year,
        period_month: month,
        templates_considered: templates.length,
        expenses_created: created.count,
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

  private async loadOrThrow(id: string, user: JwtClaims): Promise<operational_expenses> {
    const exp = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.operational_expenses.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!exp) {
      throw new AppException({ code: 'EXPENSE_NOT_FOUND', title: 'Chi phí không tồn tại', status: 404 });
    }
    return exp;
  }
}
