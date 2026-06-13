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
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { parseIfMatch } from '@/shared/if-match';
import { CleaningService } from './cleaning.service';
import {
  AssignCleaningTaskDto,
  CancelCleaningTaskDto,
  CleaningTaskListQueryDto,
  CompleteCleaningTaskDto,
  CreateCleaningTaskDto,
  PresignPhotoDto,
  StartCleaningTaskDto,
  UpdateCleaningTaskDto,
  VerifyCleaningTaskDto,
} from './dto';

/**
 * /api/v1/cleaning-tasks — việc dọn phòng (task 4.1, docs/03 §4.9). Property-scoped:
 * pha-1 RBAC (decorator) + pha-2 authorizeOnProperty (service, lấy property_id TỪ
 * entity). Điều phối (tạo/gán/nghiệm thu/huỷ/sửa) cần `cleaning_task.assign`; dọn
 * (xem/bắt đầu/hoàn tất/presign ảnh) cần `cleaning_task.complete` (HOUSEKEEPER có).
 * Auto-sinh khi CHECKED_OUT/switch do bookings.service gọi trực tiếp — không endpoint.
 */
@Controller('cleaning-tasks')
export class CleaningController {
  constructor(private readonly cleaning: CleaningService) {}

  @Post()
  @RequirePermissions('cleaning_task.assign')
  async create(@Body() dto: CreateCleaningTaskDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.cleaning.create(dto, user) };
  }

  @Get()
  @RequirePermissions('cleaning_task.complete')
  async list(@Query() query: CleaningTaskListQueryDto, @CurrentUser() user: JwtClaims) {
    const { data, page_info } = await this.cleaning.list(query.property_id, user, query);
    return { data, page_info };
  }

  @Get(':id')
  @RequirePermissions('cleaning_task.complete')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.cleaning.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('cleaning_task.assign')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: UpdateCleaningTaskDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.cleaning.update(id, parseIfMatch(ifMatch), dto, user) };
  }

  /** Gán/đổi người dọn. */
  @Post(':id/assign')
  @RequirePermissions('cleaning_task.assign')
  @HttpCode(200)
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCleaningTaskDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.cleaning.assign(id, dto, user) };
  }

  /** Bắt đầu dọn (PENDING→IN_PROGRESS). */
  @Post(':id/start')
  @RequirePermissions('cleaning_task.complete')
  @HttpCode(200)
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartCleaningTaskDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.cleaning.start(id, dto, user) };
  }

  /** Hoàn tất dọn (IN_PROGRESS→COMPLETED). */
  @Post(':id/complete')
  @RequirePermissions('cleaning_task.complete')
  @HttpCode(200)
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteCleaningTaskDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.cleaning.complete(id, dto, user) };
  }

  /** Nghiệm thu (COMPLETED→VERIFIED) — phòng về CLEAN. */
  @Post(':id/verify')
  @RequirePermissions('cleaning_task.assign')
  @HttpCode(200)
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyCleaningTaskDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.cleaning.verify(id, dto, user) };
  }

  /** Huỷ task (cần lý do). */
  @Post(':id/cancel')
  @RequirePermissions('cleaning_task.assign')
  @HttpCode(200)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCleaningTaskDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.cleaning.cancel(id, dto.reason, user) };
  }

  /** Xin URL pre-signed để upload ảnh before/after lên S3. */
  @Post(':id/photos/presign')
  @RequirePermissions('cleaning_task.complete')
  @HttpCode(200)
  async presignPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignPhotoDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.cleaning.presignPhoto(id, dto, user) };
  }
}
