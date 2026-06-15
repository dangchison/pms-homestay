import { z } from 'zod';
import { UserRoleSchema } from './auth';

/**
 * Users & per-property roles (task 6.7 S2, docs/04 §4). Override quyền per-property
 * qua user_property_roles.permissions {grant, deny}: effective = (role default ∪
 * grant) ∖ deny. grant/deny là mảng permission key (BE validate theo catalog).
 */
export const UserResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  full_name: z.string(),
  phone: z.string().nullable(),
  default_role: UserRoleSchema,
  is_active: z.boolean(),
  two_factor_enabled: z.boolean(),
  last_login_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

/** Mời user mới (tạo account + gửi email đặt mật khẩu). */
export const InviteUserRequestSchema = z.object({
  email: z.email(),
  full_name: z.string().min(1).max(255),
  default_role: UserRoleSchema,
  phone: z.string().max(20).optional(),
});
export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>;

export const UpdateUserRequestSchema = z
  .object({
    full_name: z.string().min(1).max(255).optional(),
    phone: z.string().max(20).nullable().optional(),
    default_role: UserRoleSchema.optional(),
    is_active: z.boolean().optional(), // deactivate / reactivate
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

/** Override grant/deny per-property (permission key dạng chuỗi — BE validate). */
export const PropertyRolePermissionsSchema = z.object({
  grant: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});
export type PropertyRolePermissions = z.infer<typeof PropertyRolePermissionsSchema>;

export const UserPropertyRoleResponseSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  property_id: z.uuid(),
  role: UserRoleSchema,
  permissions: PropertyRolePermissionsSchema,
  granted_at: z.iso.datetime(),
});
export type UserPropertyRoleResponse = z.infer<typeof UserPropertyRoleResponseSchema>;

/** Gán role cho user × property (kèm override tuỳ chọn). */
export const AssignPropertyRoleRequestSchema = z.object({
  user_id: z.uuid(),
  property_id: z.uuid(),
  role: UserRoleSchema,
  permissions: PropertyRolePermissionsSchema.optional(),
});
export type AssignPropertyRoleRequest = z.infer<typeof AssignPropertyRoleRequestSchema>;

export const UpdatePropertyRoleRequestSchema = z
  .object({
    role: UserRoleSchema.optional(),
    permissions: PropertyRolePermissionsSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdatePropertyRoleRequest = z.infer<typeof UpdatePropertyRoleRequestSchema>;
