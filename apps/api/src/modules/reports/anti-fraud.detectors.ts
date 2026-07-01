import { type AntiFraudFinding } from '@pms/shared-types';
import { type Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Ngưỡng cờ REFUND_ANOMALY_BY_STAFF (Pattern 2). Vượt CẢ tổng tuyệt đối lẫn số lần
 * → HIGH; chỉ vượt z-score (mean + k·stddev, cần ≥2 staff) → MEDIUM. Ngưỡng tuyệt
 * đối tránh chia-0/nhiễu khi ít mẫu; z-score bắt bất thường tương đối giữa các staff.
 */
export const REFUND_FLAG_MIN_TOTAL_VND = 2_000_000;
export const REFUND_FLAG_MIN_COUNT = 3;
export const REFUND_ZSCORE_K = 2;

/**
 * audit.interceptor lưu entity_type = segment URL số nhiều ('bookings'/'invoices');
 * finding trả số ít. Map plural→singular khi trả; unknown giữ nguyên (không xảy ra
 * vì đã lọc theo whitelist khi query audit).
 */
function auditEntityToSingular(entityType: string): 'booking' | 'invoice' {
  return entityType === 'invoices' ? 'invoice' : 'booking';
}

/** Số tiền từ BigInt an toàn về number cho VND (giá trị lớn vẫn trong Number). */
function toVnd(v: bigint | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}

/**
 * ── Pattern 1: CANCEL_AFTER_CASH ──────────────────────────────────────────────
 * Booking chuyển CANCELLED/NO_SHOW (booking_status_history.created_at ∈ [from,to])
 * SAU khi đã có payment CASH thu (received_at < thời điểm chuyển). amount = tổng
 * CASH net (amount − refunded) của booking. Join payments→invoices→bookings (không
 * có payments.booking_id trực tiếp). Booking hủy KHÔNG có CASH → không sinh finding.
 */
export async function detectCancelAfterCash(
  tx: Tx,
  propertyId: string,
  from: Date,
  to: Date,
): Promise<AntiFraudFinding[]> {
  const rows = await tx.$queryRaw<
    {
      booking_id: string;
      booking_code: string;
      occurred_at: Date;
      net_cash_vnd: bigint | null;
    }[]
  >`
    WITH cancel_events AS (
      SELECT DISTINCT ON (h.booking_id)
        h.booking_id, h.created_at AS occurred_at
      FROM booking_status_history h
      JOIN bookings b ON b.tenant_id = h.tenant_id AND b.id = h.booking_id
      WHERE b.property_id = ${propertyId}::uuid
        AND h.to_status IN ('CANCELLED', 'NO_SHOW')
        AND h.created_at >= ${from} AND h.created_at <= ${to}
      ORDER BY h.booking_id, h.created_at ASC
    )
    SELECT b.id AS booking_id, b.booking_code, ce.occurred_at,
           SUM(p.amount_vnd - p.refunded_amount_vnd)::bigint AS net_cash_vnd
    FROM cancel_events ce
    JOIN bookings b ON b.id = ce.booking_id
    JOIN invoices i ON i.tenant_id = b.tenant_id AND i.booking_id = b.id
    JOIN payments p ON p.tenant_id = i.tenant_id AND p.invoice_id = i.id
    WHERE p.method = 'CASH'
      AND p.status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
      AND p.received_at IS NOT NULL
      AND p.received_at <= ce.occurred_at
    GROUP BY b.id, b.booking_code, ce.occurred_at
    HAVING SUM(p.amount_vnd - p.refunded_amount_vnd) > 0`;

  return rows.map((r) => ({
    type: 'CANCEL_AFTER_CASH' as const,
    severity: 'HIGH' as const,
    booking_code: r.booking_code,
    staff_id: null,
    staff_name: null,
    amount_vnd: toVnd(r.net_cash_vnd),
    occurred_at: r.occurred_at.toISOString(),
    entity_type: 'booking' as const,
    entity_id: r.booking_id,
    detail: 'Booking bị hủy/NO_SHOW sau khi đã thu tiền mặt',
  }));
}

/**
 * ── Pattern 2: REFUND_ANOMALY_BY_STAFF ────────────────────────────────────────
 * Gom refund (refunded_amount_vnd>0, refunded_at ∈ [from,to]) theo received_by
 * (người giữ cash gốc — payments chưa lưu người thực hiện refund; audit refund còn
 * TODO 4.5). Cờ HIGH khi vượt CẢ ngưỡng tổng + số lần; MEDIUM khi chỉ vượt z-score
 * (mean + k·stddev, cần ≥2 staff). staff dưới ngưỡng → không cờ.
 */
export async function detectRefundAnomalyByStaff(
  tx: Tx,
  propertyId: string,
  from: Date,
  to: Date,
): Promise<AntiFraudFinding[]> {
  const rows = await tx.$queryRaw<
    {
      staff_id: string;
      total_refunded_vnd: bigint | null;
      refund_count: bigint;
      last_refunded_at: Date;
      top_payment_id: string;
    }[]
  >`
    WITH refunds AS (
      SELECT p.id AS payment_id, p.received_by, p.refunded_amount_vnd, p.refunded_at
      FROM payments p
      JOIN invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id
      JOIN bookings b ON b.tenant_id = i.tenant_id AND b.id = i.booking_id
      WHERE b.property_id = ${propertyId}::uuid
        AND p.refunded_amount_vnd > 0
        AND p.refunded_at IS NOT NULL
        AND p.refunded_at >= ${from} AND p.refunded_at <= ${to}
        AND p.received_by IS NOT NULL
    )
    SELECT r.received_by AS staff_id,
           SUM(r.refunded_amount_vnd)::bigint AS total_refunded_vnd,
           COUNT(*)::bigint AS refund_count,
           MAX(r.refunded_at) AS last_refunded_at,
           (SELECT r2.payment_id FROM refunds r2
              WHERE r2.received_by = r.received_by
              ORDER BY r2.refunded_amount_vnd DESC, r2.payment_id ASC LIMIT 1) AS top_payment_id
    FROM refunds r
    GROUP BY r.received_by`;

  if (rows.length === 0) return [];

  const totals = rows.map((r) => toVnd(r.total_refunded_vnd));
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance = totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
  const stddev = Math.sqrt(variance);
  const zThreshold = mean + REFUND_ZSCORE_K * stddev;

  const findings: AntiFraudFinding[] = [];
  for (const r of rows) {
    const total = toVnd(r.total_refunded_vnd);
    const count = Number(r.refund_count);
    const overAbsolute = total >= REFUND_FLAG_MIN_TOTAL_VND && count >= REFUND_FLAG_MIN_COUNT;
    // z-score chỉ có nghĩa khi ≥2 staff và có phân tán (stddev>0) → tránh cờ toàn bộ.
    const overZScore = rows.length >= 2 && stddev > 0 && total > zThreshold;
    if (!overAbsolute && !overZScore) continue;
    findings.push({
      type: 'REFUND_ANOMALY_BY_STAFF',
      severity: overAbsolute ? 'HIGH' : 'MEDIUM',
      booking_code: null,
      staff_id: r.staff_id,
      staff_name: null, // resolve ở service (join users.full_name)
      amount_vnd: total,
      occurred_at: r.last_refunded_at.toISOString(),
      entity_type: 'payment',
      entity_id: r.top_payment_id,
      detail: `Nhân viên hoàn tiền bất thường: ${count} lần, tổng ${total}đ`,
    });
  }
  return findings;
}

/**
 * ── Pattern 3: NO_SHOW_DEPOSIT_REMOVED ────────────────────────────────────────
 * Booking NO_SHOW có DEPOSIT invoice TỪNG thu (paid_at set / có CASH DEPOSIT) NHƯNG
 * cọc bị rút: invoice.status='VOID' HOẶC paid_vnd=0 HOẶC payment DEPOSIT bị refund.
 * KHÔNG cờ forfeit hợp lệ (DEPOSIT vẫn PAID + có ADJUSTMENT DEPOSIT_APPLIED ref →
 * DEPOSIT). occurred_at = voided_at/refunded_at. amount = số cọc từng thu.
 */
export async function detectNoShowDepositRemoved(
  tx: Tx,
  propertyId: string,
  from: Date,
  to: Date,
): Promise<AntiFraudFinding[]> {
  const rows = await tx.$queryRaw<
    {
      invoice_id: string;
      booking_code: string;
      forfeited_vnd: bigint | null;
      occurred_at: Date;
    }[]
  >`
    WITH no_show_bookings AS (
      SELECT DISTINCT b.id, b.booking_code
      FROM bookings b
      WHERE b.property_id = ${propertyId}::uuid
        AND (
          b.status = 'NO_SHOW'
          OR EXISTS (
            SELECT 1 FROM booking_status_history h
            WHERE h.tenant_id = b.tenant_id AND h.booking_id = b.id
              AND h.to_status = 'NO_SHOW'
          )
        )
    ),
    deposit_paid AS (
      -- cọc từng thu = tổng CASH DEPOSIT SUCCEEDED/refunded (số đã vào két trước khi rút)
      SELECT i.id AS invoice_id, i.booking_id, i.status, i.paid_vnd, i.paid_at, i.voided_at,
             COALESCE(SUM(p.amount_vnd) FILTER (
               WHERE p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')), 0)::bigint AS cash_paid_vnd,
             COALESCE(SUM(p.refunded_amount_vnd), 0)::bigint AS refunded_vnd,
             MAX(p.refunded_at) AS last_refunded_at
      FROM invoices i
      JOIN no_show_bookings nsb ON nsb.id = i.booking_id
      LEFT JOIN payments p ON p.tenant_id = i.tenant_id AND p.invoice_id = i.id
      WHERE i.kind = 'DEPOSIT'
      GROUP BY i.id, i.booking_id, i.status, i.paid_vnd, i.paid_at, i.voided_at
    )
    SELECT dp.invoice_id, nsb.booking_code,
           GREATEST(dp.cash_paid_vnd, dp.paid_vnd)::bigint AS forfeited_vnd,
           COALESCE(dp.voided_at, dp.last_refunded_at, dp.paid_at) AS occurred_at
    FROM deposit_paid dp
    JOIN no_show_bookings nsb ON nsb.id = dp.booking_id
    WHERE
      -- Từng thu cọc (paid_at set HOẶC có CASH vào két)
      (dp.paid_at IS NOT NULL OR dp.cash_paid_vnd > 0)
      -- Cọc bị rút: VOID | paid_vnd=0 | có refund
      AND (dp.status = 'VOID' OR dp.paid_vnd = 0 OR dp.refunded_vnd > 0)
      -- Thời điểm rút nằm trong kỳ
      AND COALESCE(dp.voided_at, dp.last_refunded_at, dp.paid_at) >= ${from}
      AND COALESCE(dp.voided_at, dp.last_refunded_at, dp.paid_at) <= ${to}`;

  return rows
    .filter((r) => toVnd(r.forfeited_vnd) > 0)
    .map((r) => ({
      type: 'NO_SHOW_DEPOSIT_REMOVED' as const,
      severity: 'HIGH' as const,
      booking_code: r.booking_code,
      staff_id: null,
      staff_name: null,
      amount_vnd: toVnd(r.forfeited_vnd),
      occurred_at: r.occurred_at.toISOString(),
      entity_type: 'invoice' as const,
      entity_id: r.invoice_id,
      detail: 'Booking NO_SHOW có cọc từng thu nhưng đã bị rút (VOID/refund/paid=0)',
    }));
}

/**
 * ── Pattern 4: PRICE_EDIT_AFTER_CHECKIN ───────────────────────────────────────
 * audit_logs UPDATE trên bookings/invoices của booking đã check-in (actual_check_in
 * set), created_at > actual_check_in. audit_logs KHÔNG có property_id → (a) lấy
 * candidate booking/invoice ids theo property TRONG RLS trước, rồi (b) query audit
 * theo entity_id ∈ ids (tránh quét audit toàn tenant). entity_type plural→singular.
 * amount = delta tiền suy từ after_data nếu có, else 0.
 */
export async function detectPriceEditAfterCheckin(
  tx: Tx,
  propertyId: string,
  from: Date,
  to: Date,
): Promise<AntiFraudFinding[]> {
  // (a) Candidate: booking đã check-in + invoice của nó (map id → booking_code + mốc check-in).
  const bookings = await tx.bookings.findMany({
    where: { property_id: propertyId, actual_check_in: { not: null } },
    select: { id: true, booking_code: true, actual_check_in: true },
  });
  if (bookings.length === 0) return [];

  const byBookingId = new Map(bookings.map((b) => [b.id, b]));
  const bookingIds = bookings.map((b) => b.id);
  const invoices = await tx.invoices.findMany({
    where: { booking_id: { in: bookingIds } },
    select: { id: true, booking_id: true },
  });
  // invoice_id → booking (để tra booking_code + actual_check_in của booking cha).
  const invoiceToBooking = new Map(
    invoices
      .map((i) => (i.booking_id ? ([i.id, byBookingId.get(i.booking_id)] as const) : null))
      .filter((x): x is [string, (typeof bookings)[number]] => x != null && x[1] != null),
  );

  const entityIds = [...bookingIds, ...invoices.map((i) => i.id)];

  // (b) audit UPDATE trên các entity_id ứng viên, trong kỳ.
  const audits = await tx.audit_logs.findMany({
    where: {
      action: 'UPDATE',
      entity_type: { in: ['bookings', 'invoices'] },
      entity_id: { in: entityIds },
      created_at: { gte: from, lte: to },
    },
    select: {
      user_id: true,
      entity_type: true,
      entity_id: true,
      created_at: true,
      before_data: true,
      after_data: true,
    },
    orderBy: { created_at: 'desc' },
  });

  const findings: AntiFraudFinding[] = [];
  for (const a of audits) {
    if (!a.entity_id) continue;
    const singular = auditEntityToSingular(a.entity_type);
    const booking =
      singular === 'booking' ? byBookingId.get(a.entity_id) : invoiceToBooking.get(a.entity_id);
    if (!booking || !booking.actual_check_in) continue;
    // Chỉ cờ khi sửa SAU check-in.
    if (a.created_at <= booking.actual_check_in) continue;

    findings.push({
      type: 'PRICE_EDIT_AFTER_CHECKIN',
      severity: 'MEDIUM',
      booking_code: booking.booking_code,
      staff_id: a.user_id,
      staff_name: null, // resolve ở service
      amount_vnd: deltaFromAudit(a.before_data, a.after_data),
      occurred_at: a.created_at.toISOString(),
      entity_type: singular,
      entity_id: a.entity_id,
      detail: 'Sửa giá/tiền booking-invoice sau khi khách đã check-in',
    });
  }
  return findings;
}

/**
 * Suy delta tiền từ audit before/after — hỗ trợ khóa total_amount_vnd/total_vnd/price.
 * Trả |after − before| nếu suy được (before có ở interceptor mutation thì =0, nhưng
 * service có thể ghi before/after tường minh); else 0.
 */
function deltaFromAudit(beforeData: unknown, afterData: unknown): number {
  const keys = ['total_amount_vnd', 'total_vnd', 'price_vnd', 'unit_price_vnd', 'amount_vnd'];
  const before = pickNumber(beforeData, keys);
  const after = pickNumber(afterData, keys);
  if (before != null && after != null) return Math.abs(after - before);
  return 0;
}

function pickNumber(data: unknown, keys: string[]): number | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
