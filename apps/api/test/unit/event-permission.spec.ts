import { type JwtClaims, type RealtimeEvent, type UserRole } from '@pms/shared-types';
import { describe, expect, it } from 'vitest';
import { buildEventScope, canUserSeeEvent } from '@modules/events/event-permission';

/**
 * ★ Filter SSE theo quyền (docs/10 §5) — pure function, không cần app/DB.
 * Bảng quyền:
 *   booking.*        → OWNER; MANAGER/STAFF của property
 *   payment/invoice.* → OWNER, ACCOUNTANT, MANAGER của property
 *   cleaning_task.*  → OWNER, MANAGER, STAFF, HOUSEKEEPER của property
 *   room.*           → OWNER, MANAGER, STAFF, HOUSEKEEPER của property
 *   sync_job.*       → OWNER, MANAGER
 */

const scope = (rol: UserRole, props: string[]) =>
  buildEventScope({ rol, scp: props } as JwtClaims);

const ev = (event_type: string, property_id?: string): RealtimeEvent => ({
  event_id: '00000000-0000-0000-0000-000000000000',
  event_type,
  payload: property_id ? { property_id } : {},
  ts: '2026-01-01T00:00:00.000Z',
});

describe('canUserSeeEvent (docs/10 §5)', () => {
  it('OWNER thấy MỌI event trong tenant (không cần property scope)', () => {
    const owner = scope('OWNER', []);
    expect(canUserSeeEvent(owner, ev('payment.received', 'pX'))).toBe(true);
    expect(canUserSeeEvent(owner, ev('booking.created', 'pX'))).toBe(true);
    expect(canUserSeeEvent(owner, ev('sync_job.failed', 'pX'))).toBe(true);
  });

  it('STAFF: booking/room/cleaning của property trong scope; KHÔNG payment/invoice/sync', () => {
    const s = scope('STAFF', ['p1']);
    expect(canUserSeeEvent(s, ev('booking.created', 'p1'))).toBe(true);
    expect(canUserSeeEvent(s, ev('booking.created', 'p2'))).toBe(false); // ngoài scope
    expect(canUserSeeEvent(s, ev('room.housekeeping_changed', 'p1'))).toBe(true);
    expect(canUserSeeEvent(s, ev('cleaning_task.assigned', 'p1'))).toBe(true);
    expect(canUserSeeEvent(s, ev('payment.received', 'p1'))).toBe(false);
    expect(canUserSeeEvent(s, ev('invoice.issued', 'p1'))).toBe(false);
    expect(canUserSeeEvent(s, ev('sync_job.completed', 'p1'))).toBe(false);
  });

  it('ACCOUNTANT: payment/invoice của property trong scope; KHÔNG booking/room/sync', () => {
    const s = scope('ACCOUNTANT', ['p1']);
    expect(canUserSeeEvent(s, ev('payment.received', 'p1'))).toBe(true);
    expect(canUserSeeEvent(s, ev('invoice.overdue', 'p1'))).toBe(true);
    expect(canUserSeeEvent(s, ev('payment.received', 'p2'))).toBe(false);
    expect(canUserSeeEvent(s, ev('booking.created', 'p1'))).toBe(false);
    expect(canUserSeeEvent(s, ev('room.blocked', 'p1'))).toBe(false);
    expect(canUserSeeEvent(s, ev('sync_job.completed', 'p1'))).toBe(false);
  });

  it('MANAGER: gần như mọi loại của property trong scope (gồm sync_job)', () => {
    const s = scope('MANAGER', ['p1']);
    for (const type of [
      'booking.created',
      'payment.received',
      'invoice.issued',
      'room.blocked',
      'cleaning_task.assigned',
      'sync_job.failed',
    ]) {
      expect(canUserSeeEvent(s, ev(type, 'p1'))).toBe(true);
    }
    expect(canUserSeeEvent(s, ev('booking.created', 'p2'))).toBe(false); // ngoài scope
  });

  it('HOUSEKEEPER: room/cleaning của property; KHÔNG booking/payment/sync', () => {
    const s = scope('HOUSEKEEPER', ['p1']);
    expect(canUserSeeEvent(s, ev('cleaning_task.assigned', 'p1'))).toBe(true);
    expect(canUserSeeEvent(s, ev('room.housekeeping_changed', 'p1'))).toBe(true);
    expect(canUserSeeEvent(s, ev('booking.created', 'p1'))).toBe(false);
    expect(canUserSeeEvent(s, ev('payment.received', 'p1'))).toBe(false);
    expect(canUserSeeEvent(s, ev('sync_job.failed', 'p1'))).toBe(false);
  });

  it('event thiếu property_id → non-owner KHÔNG thấy (không route được)', () => {
    expect(canUserSeeEvent(scope('MANAGER', ['p1']), ev('booking.created', undefined))).toBe(false);
    expect(canUserSeeEvent(scope('STAFF', ['p1']), ev('room.blocked', undefined))).toBe(false);
  });
});
