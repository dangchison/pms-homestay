import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { type Response } from 'express';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { RequirePlanFeature } from '@core/billing/plan-feature';
import { InvoicesService } from '@modules/invoices/invoices.service';
import { VietqrService } from './vietqr.service';

/**
 * GET /api/v1/invoices/:id/qr-image (docs/09 §5, docs/12 §5) — PNG VietQR động
 * theo số dư còn nợ. Đặt ở payments module (sở hữu VietQR) nhưng phục vụ path
 * /invoices để FE gọi tự nhiên. `@Res` trả binary trực tiếp (không bọc {data}).
 */
@Controller('invoices')
@RequirePlanFeature('vietqr')
export class InvoiceQrController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly vietqr: VietqrService,
  ) {}

  @Get(':id/qr-image')
  @RequirePermissions('invoice.read')
  async qrImage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtClaims,
    @Res() res: Response,
  ): Promise<void> {
    const target = await this.invoices.getQrTarget(id, user);
    const payload = this.vietqr.buildPayload({
      bankBin: target.bankBin,
      accountNumber: target.accountNumber,
      amount: target.amount,
      addInfo: target.addInfo,
    });
    const png = await this.vietqr.toPng(payload);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store'); // QR đổi theo số dư → không cache
    res.send(png);
  }
}
