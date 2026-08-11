import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { SubscriptionService } from './subscription.service';

/**
 * /api/v1/public/plans — bảng giá cho trang web công khai (web-site). Khách chưa
 * có tài khoản nên không thể dùng /billing/plans (đòi quyền tenant.billing.manage).
 * @Public + @SkipTenantScope: ngoài tenant scope hoàn toàn.
 *
 * Dữ liệu là master data đổi rất thưa → cache 5 phút ở CDN/trình duyệt, trang giá
 * không cần đọc DB mỗi lượt xem.
 */
@Controller('public/plans')
export class PublicPlansController {
  constructor(private readonly subscription: SubscriptionService) {}

  @Get()
  @Public()
  @SkipTenantScope()
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  async list() {
    return { data: await this.subscription.listPlans() };
  }
}
