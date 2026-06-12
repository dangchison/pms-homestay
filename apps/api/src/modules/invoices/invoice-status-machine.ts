import { type InvoiceStatus } from '@pms/shared-types';
import { AppException } from '@core/http/exceptions/app.exception';

/**
 * State machine invoice tập trung (docs/09 §3). Transition sai → 422.
 *
 * DRAFT → ISSUED | VOID
 * ISSUED → PARTIALLY_PAID | PAID | OVERDUE | VOID
 * PARTIALLY_PAID → PAID | OVERDUE | VOID
 * OVERDUE → PARTIALLY_PAID | PAID | VOID
 * PAID → REFUNDED
 * (VOID | REFUNDED = terminal)
 */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ['ISSUED', 'VOID'],
  ISSUED: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE', 'VOID'],
  OVERDUE: ['PARTIALLY_PAID', 'PAID', 'VOID'],
  PAID: ['REFUNDED'],
  VOID: [],
  REFUNDED: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) {
    throw new AppException({
      code: 'INVOICE_INVALID_STATUS',
      title: `Không thể chuyển hoá đơn ${from} → ${to}`,
      status: 422,
    });
  }
}
