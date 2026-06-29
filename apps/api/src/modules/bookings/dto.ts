import {
  BookingStatusSchema,
  CancelBookingRequestSchema,
  ConfirmBookingRequestSchema,
  CreateBookingRequestSchema,
  CreateBookingSurchargeRequestSchema,
  OffsetPaginationQuerySchema,
  RescheduleBookingRequestSchema,
  SwitchResourceRequestSchema,
  TodayBoardQuerySchema,
  UpdateBookingRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateBookingDto extends createZodDto(CreateBookingRequestSchema) {}
export class UpdateBookingDto extends createZodDto(UpdateBookingRequestSchema) {}
export class CancelBookingDto extends createZodDto(CancelBookingRequestSchema) {}
export class ConfirmBookingDto extends createZodDto(ConfirmBookingRequestSchema) {}
export class SwitchResourceDto extends createZodDto(SwitchResourceRequestSchema) {}
export class RescheduleBookingDto extends createZodDto(RescheduleBookingRequestSchema) {}
export class CreateBookingSurchargeDto extends createZodDto(CreateBookingSurchargeRequestSchema) {}

const BookingListQuerySchema = OffsetPaginationQuerySchema.extend({
  property_id: z.uuid().optional(),
  status: BookingStatusSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export class BookingListQueryDto extends createZodDto(BookingListQuerySchema) {}
export class TodayBoardQueryDto extends createZodDto(TodayBoardQuerySchema) {}
