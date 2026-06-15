import {
  AssignPropertyRoleRequestSchema,
  InviteUserRequestSchema,
  UpdatePropertyRoleRequestSchema,
  UpdateUserRequestSchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class InviteUserDto extends createZodDto(InviteUserRequestSchema) {}
export class UpdateUserDto extends createZodDto(UpdateUserRequestSchema) {}
export class AssignPropertyRoleDto extends createZodDto(AssignPropertyRoleRequestSchema) {}
export class UpdatePropertyRoleDto extends createZodDto(UpdatePropertyRoleRequestSchema) {}
