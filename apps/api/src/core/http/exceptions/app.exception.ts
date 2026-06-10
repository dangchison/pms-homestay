import { HttpException } from '@nestjs/common';
import { type ApiErrorField } from '@pms/shared-types';

export interface AppExceptionOptions {
  /** Mã máy đọc được, prefix theo domain: AUTH_, BOOKING_, ... (docs/05 §error-codes) */
  code: string;
  /** Thông điệp ngắn cho người dùng */
  title: string;
  status: number;
  detail?: string;
  fields?: ApiErrorField[];
}

/**
 * Exception nghiệp vụ chuẩn RFC 7807 (docs/05 §error).
 * HttpExceptionFilter sẽ bọc thêm type/instance/request_id khi serialize.
 */
export class AppException extends HttpException {
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
  readonly fields?: ApiErrorField[];

  constructor(opts: AppExceptionOptions) {
    super({ code: opts.code, title: opts.title, detail: opts.detail }, opts.status);
    this.code = opts.code;
    this.title = opts.title;
    this.detail = opts.detail;
    this.fields = opts.fields;
  }
}

export class ValidationException extends AppException {
  constructor(fields: ApiErrorField[], detail?: string) {
    super({
      code: 'VALIDATION_FAILED',
      title: 'Dữ liệu không hợp lệ',
      status: 400,
      detail,
      fields,
    });
  }
}
