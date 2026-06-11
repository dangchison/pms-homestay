import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { QuoteDto } from './dto';
import { PricingService } from './pricing.service';

/** /api/v1/pricing (docs/07 §6). Báo giá = tính + persist `quotes` (verify ở 2.6). */
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post('quote')
  @RequirePermissions('booking.create')
  @HttpCode(200)
  async quote(@Body() dto: QuoteDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.pricing.quote(dto, user) };
  }
}
