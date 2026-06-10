import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { AppException } from '../exceptions/app.exception';
import { buildErrorBody, requestIdOf } from '../exceptions/error-response';

/** Map HttpException (gồm AppException) → RFC 7807 (docs/05 §error). */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter<HttpException> {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const status = exception.getStatus();

    if (exception instanceof AppException) {
      res.status(status).json(
        buildErrorBody({
          code: exception.code,
          title: exception.title,
          status,
          detail: exception.detail,
          fields: exception.fields,
          instance: req.originalUrl,
          requestId: requestIdOf(req),
        }),
      );
      return;
    }

    // HttpException thường (NotFoundException, ...) → suy ra code từ status
    const body = exception.getResponse();
    const message =
      typeof body === 'string'
        ? body
        : ((body as { message?: string | string[] }).message ?? exception.message);
    res.status(status).json(
      buildErrorBody({
        code: codeFromStatus(status),
        title: Array.isArray(message) ? message.join('; ') : message,
        status,
        instance: req.originalUrl,
        requestId: req.id as string | undefined,
      }),
    );
  }
}

function codeFromStatus(status: number): string {
  const map: Record<number, string> = {
    400: 'VALIDATION_FAILED',
    401: 'AUTH_UNAUTHENTICATED',
    403: 'AUTHZ_FORBIDDEN',
    404: 'RESOURCE_NOT_FOUND',
    409: 'CONFLICT',
    410: 'RESOURCE_GONE',
    422: 'BUSINESS_RULE_VIOLATION',
    423: 'RESOURCE_LOCKED',
    429: 'RATE_LIMITED',
  };
  return map[status] ?? 'SYSTEM_INTERNAL_ERROR';
}
