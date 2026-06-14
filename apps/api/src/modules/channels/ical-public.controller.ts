import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { type Request, type Response } from 'express';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { IcalPushService } from './ical-push.service';

/** If-None-Match khớp ETag? Hỗ trợ danh sách, weak `W/`, và `*`. */
function ifNoneMatchHits(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (raw.trim() === '*') return true;
  return raw
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag);
}

/**
 * Endpoint PUSH iCal CÔNG KHAI (task 5.3) — OTA pull lịch busy của resource theo
 * token bí mật. `@Public` (bỏ JWT) + `@SkipTenantScope` (bỏ tenant GUC/RLS guard);
 * resolve token cross-tenant nằm trong service. `@Res` để tự kiểm soát
 * 200/304/429/404 + header text/calendar + ETag. Rate limit 10/min/IP/token.
 */
@Controller('public/sync/ical')
export class IcalPublicController {
  constructor(private readonly push: IcalPushService) {}

  @Get(':token')
  @Public()
  @SkipTenantScope()
  async getCalendar(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.push.assertWithinRateLimit(req.ip ?? 'unknown', token);
    const { etag, body } = await this.push.getResourceCalendar(token, new Date());

    if (ifNoneMatchHits(req.headers['if-none-match'], etag)) {
      res.status(304).setHeader('ETag', etag).end();
      return;
    }
    res
      .status(200)
      .setHeader('Content-Type', 'text/calendar; charset=utf-8')
      .setHeader('ETag', etag)
      .setHeader('Cache-Control', 'public, max-age=300')
      .send(body);
  }
}
