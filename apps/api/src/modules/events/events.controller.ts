import { Controller, Get, type MessageEvent, Req, Sse } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { type Request } from 'express';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { TokenService } from '@core/auth/token.service';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { AppException } from '@core/http/exceptions/app.exception';
import { EventBusService } from './event-bus.service';
import { buildEventScope, canUserSeeEvent } from './event-permission';

const HEARTBEAT_MS = 30_000;

/**
 * /api/v1/events/stream — SSE realtime (task 4.2, docs/10 §4).
 *
 * @Public + @SkipTenantScope: BỎ QUA global guard rồi verify token THỦ CÔNG vì
 * `EventSource` của browser KHÔNG gửi được header Authorization (access token
 * in-memory, không nằm trong cookie). Nhận token qua header `Bearer`
 * (supertest/fetch-event-source) HOẶC `?access_token=` (EventSource native).
 * KHÔNG mở transaction/withTenant cho stream (ADR-0002).
 */
@Controller('events')
export class EventsController {
  constructor(
    private readonly eventBus: EventBusService,
    private readonly tokenService: TokenService,
  ) {}

  @Get('stream')
  @Public()
  @SkipTenantScope()
  @Sse()
  stream(@Req() req: Request): Observable<MessageEvent> {
    const user = this.authenticate(req);
    const scope = buildEventScope(user);
    return merge(
      this.eventBus.forTenant(user.tnt).pipe(
        filter((event) => canUserSeeEvent(scope, event)),
        // id = event_id → client dedup (at-least-once); event mặc định 'message' → onmessage
        map((event): MessageEvent => ({ id: event.event_id, data: event })),
      ),
      // Heartbeat dưới named event 'ping' → client onmessage KHÔNG kích; chỉ giữ
      // kết nối qua proxy (docs/10 §4).
      interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: 'keep-alive' }))),
    );
  }

  private authenticate(req: Request): JwtClaims {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : typeof req.query.access_token === 'string'
        ? req.query.access_token
        : undefined;
    if (!token) {
      throw new AppException({ code: 'AUTH_UNAUTHENTICATED', title: 'Cần đăng nhập', status: 401 });
    }
    try {
      return this.tokenService.verifyAccessToken(token);
    } catch {
      throw new AppException({
        code: 'AUTH_TOKEN_INVALID',
        title: 'Token không hợp lệ hoặc đã hết hạn',
        status: 401,
      });
    }
  }
}
