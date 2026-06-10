import { type ApiError, type ApiErrorField } from '@pms/shared-types';

const ERROR_DOCS_BASE = 'https://docs.pmsapp.vn/errors';

/** request_id do pino-http gán (req.id) — đọc an toàn không phụ thuộc type augmentation. */
export function requestIdOf(req: unknown): string | undefined {
  const id = (req as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

/** Dựng body lỗi RFC 7807 + extensions thống nhất (docs/05 §error). */
export function buildErrorBody(params: {
  code: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  fields?: ApiErrorField[];
}): ApiError {
  return {
    error: {
      type: `${ERROR_DOCS_BASE}/${params.code.toLowerCase().replaceAll('_', '-')}`,
      code: params.code,
      title: params.title,
      status: params.status,
      ...(params.detail ? { detail: params.detail } : {}),
      ...(params.instance ? { instance: params.instance } : {}),
      ...(params.requestId ? { request_id: params.requestId } : {}),
      ...(params.fields?.length ? { fields: params.fields } : {}),
    },
  };
}
