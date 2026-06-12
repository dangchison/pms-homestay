import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { CreateInvoiceDto, InvoiceListQueryDto, VoidInvoiceDto } from './dto';
import { InvoicesService } from './invoices.service';

/** /api/v1/invoices (docs/09 §4). DEPOSIT/STAY auto-sinh từ booking; đây là ad-hoc + tra cứu. */
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @RequirePermissions('invoice.create_adhoc')
  async create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.invoices.createAdHoc(dto, user) };
  }

  @Get()
  @RequirePermissions('invoice.read')
  async list(@Query() query: InvoiceListQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.invoices.listByBooking(query.booking_id, user) };
  }

  @Get(':id')
  @RequirePermissions('invoice.read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.invoices.getById(id, user) };
  }

  @Post(':id/issue')
  @RequirePermissions('invoice.create_adhoc')
  @HttpCode(200)
  async issue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.invoices.issue(id, user) };
  }

  @Post(':id/void')
  @RequirePermissions('invoice.void')
  @HttpCode(200)
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidInvoiceDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.invoices.void(id, dto, user) };
  }
}
