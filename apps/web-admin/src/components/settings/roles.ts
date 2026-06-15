import type { UserRole } from '@pms/shared-types';

export const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: 'Chủ nhà',
  MANAGER: 'Quản lý',
  ACCOUNTANT: 'Kế toán',
  STAFF: 'Lễ tân',
  HOUSEKEEPER: 'Buồng phòng',
};

export const ROLE_OPTIONS: UserRole[] = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'STAFF', 'HOUSEKEEPER'];
