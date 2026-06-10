import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { type Request, type Response } from 'express';
import { Logger } from 'nestjs-pino';
import { buildErrorBody, requestIdOf } from '../exceptions/error-response';

/**
 * Bảng map lỗi PostgreSQL → mã nghiệp vụ (docs/05, docs/06 §3).
 * 23P01 (exclusion_violation trên room_occupancy) là đường trả 409 BOOKING_OVERLAP
 * — lớp chống overbooking cuối cùng ở DB.
 */
const PG_ERROR_MAP: Record<string, { status: number; code: string; title: string }> = {
  '23P01': { status: 409, code: 'BOOKING_OVERLAP', title: 'Khoảng thời gian đã bị giữ/đặt' },
  '23505': { status: 409, code: 'DUPLICATE_RESOURCE', title: 'Dữ liệu đã tồn tại' },
  '23503': { status: 409, code: 'REFERENCE_VIOLATION', title: 'Dữ liệu tham chiếu không hợp lệ' },
  '40001': { status: 409, code: 'SERIALIZATION_CONFLICT', title: 'Xung đột giao dịch — thử lại' },
  '40P01': { status: 409, code: 'DEADLOCK_DETECTED', title: 'Xung đột giao dịch — thử lại' },
};

interface PgLikeError {
  code?: string;
  meta?: { code?: string };
  message?: string;
}

/** Tìm mã lỗi PG trong error thô của driver hoặc PrismaClientKnownRequestError. */
function extractPgCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as PgLikeError;
  if (e.code && PG_ERROR_MAP[e.code]) return e.code;
  if (e.meta?.code && PG_ERROR_MAP[e.meta.code]) return e.meta.code;
  return undefined;
}

/**
 * Catch-all cuối chuỗi: lỗi PG đã biết → 409 có mã; còn lại → 500 RFC 7807,
 * log đầy đủ qua pino (KHÔNG lộ chi tiết nội bộ ra response).
 */
@Catch()
export class PgErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = requestIdOf(req);

    // HttpException lọt vào đây chỉ khi filter chuyên trách bị gỡ — vẫn xử lý đúng
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(
        buildErrorBody({
          code: 'HTTP_ERROR',
          title: exception.message,
          status: exception.getStatus(),
          instance: req.originalUrl,
          requestId,
        }),
      );
      return;
    }

    const pgCode = extractPgCode(exception);
    if (pgCode) {
      const mapped = PG_ERROR_MAP[pgCode]!;
      res.status(mapped.status).json(
        buildErrorBody({
          ...mapped,
          instance: req.originalUrl,
          requestId,
        }),
      );
      return;
    }

    this.logger.error(
      { err: exception, request_id: requestId, path: req.originalUrl },
      'Unhandled exception',
    );
    res.status(500).json(
      buildErrorBody({
        code: 'SYSTEM_INTERNAL_ERROR',
        title: 'Lỗi hệ thống — đã ghi nhận',
        status: 500,
        instance: req.originalUrl,
        requestId,
      }),
    );
  }
}
