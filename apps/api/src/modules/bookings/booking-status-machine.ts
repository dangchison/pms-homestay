import { type BookingStatus } from '@pms/shared-types';
import { AppException } from '@core/http/exceptions/app.exception';

/**
 * State machine booking tập trung (docs/09 §booking, docs/14 §2.8).
 * Transition không hợp lệ → 422 BOOKING_INVALID_STATUS.
 *
 * HOLD → PENDING|CONFIRMED|CANCELLED
 * PENDING → CONFIRMED|CANCELLED
 * CONFIRMED → CHECKED_IN|CANCELLED|NO_SHOW
 * CHECKED_IN → CHECKED_OUT
 * (CHECKED_OUT|CANCELLED|NO_SHOW = terminal)
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  HOLD: ['PENDING', 'CONFIRMED', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const TERMINAL_STATUSES: readonly BookingStatus[] = ['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

/** Ném 422 BOOKING_INVALID_STATUS nếu chuyển trạng thái không hợp lệ. */
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new AppException({
      code: 'BOOKING_INVALID_STATUS',
      title: `Không thể chuyển trạng thái ${from} → ${to}`,
      status: 422,
    });
  }
}
