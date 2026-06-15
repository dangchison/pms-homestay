import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '@core/http/interceptors/idempotency.interceptor';
import { parseIfMatch } from '@/shared/if-match';
import { BookingsService } from './bookings.service';
import {
  BookingListQueryDto,
  CancelBookingDto,
  ConfirmBookingDto,
  CreateBookingDto,
  SwitchResourceDto,
  TodayBoardQueryDto,
  UpdateBookingDto,
} from './dto';

/** /api/v1/bookings (docs/05, docs/06). Tạo qua createBookingTx — đường ghi duy nhất. */
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @RequirePermissions('booking.create')
  @UseInterceptors(IdempotencyInterceptor)
  async create(@Body() dto: CreateBookingDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.bookings.create(dto, user) };
  }

  @Get()
  @RequirePermissions('booking.read')
  async list(@Query() query: BookingListQueryDto, @CurrentUser() user: JwtClaims) {
    const { data, page_info } = await this.bookings.list(user, query);
    return { data, page_info };
  }

  // Phải khai BEFORE @Get(':id') để 'today' không bị bắt làm param id (Nest match theo thứ tự).
  @Get('today')
  @RequirePermissions('booking.read')
  async today(@Query() query: TodayBoardQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.bookings.listTodayBoard(query, user) };
  }

  @Get(':id')
  @RequirePermissions('booking.read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.bookings.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('booking.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: UpdateBookingDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.bookings.update(id, parseIfMatch(ifMatch), dto, user) };
  }

  @Post(':id/confirm')
  @RequirePermissions('booking.update')
  @HttpCode(200)
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmBookingDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.bookings.confirm(id, dto, user) };
  }

  @Post(':id/cancel')
  @RequirePermissions('booking.cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.bookings.cancel(id, dto, user) };
  }

  @Post(':id/check-in')
  @RequirePermissions('booking.checkin_out')
  @HttpCode(200)
  async checkIn(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.bookings.checkIn(id, user) };
  }

  @Post(':id/check-out')
  @RequirePermissions('booking.checkin_out')
  @HttpCode(200)
  async checkOut(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.bookings.checkOut(id, user) };
  }

  @Post(':id/switch-resource')
  @RequirePermissions('booking.switch_resource')
  @HttpCode(200)
  async switchResource(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SwitchResourceDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.bookings.switchResource(id, dto, user) };
  }
}
