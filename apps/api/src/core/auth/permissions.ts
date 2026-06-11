import { type UserRole } from '@pms/shared-types';

/**
 * Permission matrix (docs/04 §4) — nguồn sự thật quyền mặc định theo role.
 * Override per-property qua user_property_roles.permissions {grant, deny}:
 * effective = (role default ∪ grant) ∖ deny.
 */
export const ALL_PERMISSIONS = [
  'tenant.read',
  'tenant.billing.manage',
  'user.invite',
  'user.manage_roles',
  'property.create',
  'property.delete',
  'property.read',
  'property.update',
  'room.crud',
  'resource.crud',
  'room.housekeeping.change',
  'rate_plan.manage',
  'booking.read',
  'booking.create',
  'booking.update',
  'booking.cancel',
  'booking.checkin_out',
  'booking.switch_resource',
  'invoice.read',
  'invoice.create_adhoc',
  'invoice.void',
  'payment.record',
  'payment.refund',
  'payment.reconcile',
  'expense.crud',
  'asset.crud',
  'report.financial',
  'report.operational',
  'channel.manage',
  'cleaning_task.assign',
  'cleaning_task.complete',
  'guest.pii.read',
  'audit_log.read',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const MANAGER: Permission[] = [
  'tenant.read',
  'property.read',
  'property.update',
  'room.crud',
  'resource.crud',
  'room.housekeeping.change',
  'rate_plan.manage',
  'booking.read',
  'booking.create',
  'booking.update',
  'booking.cancel',
  'booking.checkin_out',
  'booking.switch_resource',
  'invoice.read',
  'invoice.create_adhoc',
  'payment.record',
  'expense.crud',
  'asset.crud',
  'report.financial',
  'report.operational',
  'channel.manage',
  'cleaning_task.assign',
  'cleaning_task.complete',
  'guest.pii.read',
];

const ACCOUNTANT: Permission[] = [
  'tenant.read',
  'property.read',
  'booking.read',
  'invoice.read',
  'invoice.create_adhoc',
  'invoice.void',
  'payment.record',
  'payment.refund',
  'payment.reconcile',
  'expense.crud',
  'report.financial',
  'report.operational',
  'audit_log.read',
];

const STAFF: Permission[] = [
  'tenant.read',
  'property.read',
  'room.housekeeping.change',
  'booking.read',
  'booking.create',
  'booking.update',
  'booking.cancel', // cần lý do — enforce ở service (docs/04 §matrix)
  'booking.checkin_out',
  'booking.switch_resource',
  'invoice.read',
  'payment.record',
  'report.operational',
  'cleaning_task.assign',
  'cleaning_task.complete',
  'guest.pii.read',
];

const HOUSEKEEPER: Permission[] = [
  'tenant.read',
  'property.read',
  'room.housekeeping.change', // chỉ CLEANING→CLEAN — enforce ở service
  'cleaning_task.complete',
];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>(ALL_PERMISSIONS),
  MANAGER: new Set(MANAGER),
  ACCOUNTANT: new Set(ACCOUNTANT),
  STAFF: new Set(STAFF),
  HOUSEKEEPER: new Set(HOUSEKEEPER),
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
