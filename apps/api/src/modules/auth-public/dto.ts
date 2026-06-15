import {
  ChangePasswordRequestSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  RegisterTenantRequestSchema,
  ResetPasswordRequestSchema,
  TwoFaDisableRequestSchema,
  TwoFaVerifyRequestSchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

/** DTO = Zod schema dùng chung BE/FE (docs/01: một stack validation duy nhất). */
export class RegisterDto extends createZodDto(RegisterTenantRequestSchema) {}
export class LoginDto extends createZodDto(LoginRequestSchema) {}
export class ForgotPasswordDto extends createZodDto(ForgotPasswordRequestSchema) {}
export class ResetPasswordDto extends createZodDto(ResetPasswordRequestSchema) {}
export class TwoFaVerifyDto extends createZodDto(TwoFaVerifyRequestSchema) {}
export class ChangePasswordDto extends createZodDto(ChangePasswordRequestSchema) {}
export class TwoFaDisableDto extends createZodDto(TwoFaDisableRequestSchema) {}
