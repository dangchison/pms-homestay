import type { BookingStatus } from '@pms/shared-types';

/**
 * Mirror phía FE của state machine BE (apps/api/src/modules/bookings/booking-status-machine.ts
 * L14) + tập trạng thái terminal. shared-types KHÔNG export các map này nên đặt tại ĐÂY —
 * NGUỒN DUY NHẤT phía FE (page.tsx chi tiết booking + SurchargesCard import chung, tránh drift
 * mà reviewer từng bắt). Chỉ để gate hiển thị nút / ẩn thao tác; BE vẫn là nguồn chân lý
 * (trả 422 BOOKING_INVALID_STATUS khi thao tác sai trạng thái).
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

/** Trạng thái đã chốt: không còn thao tác vòng đời (add/remove phụ thu bị BE chặn 422). */
export const TERMINAL: readonly BookingStatus[] = ['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];

export const isTerminal = (s: BookingStatus): boolean => TERMINAL.includes(s);
