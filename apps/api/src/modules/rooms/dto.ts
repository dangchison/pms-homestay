import {
  CreateRoomBlockRequestSchema,
  CreateRoomRequestSchema,
  UpdateHousekeepingRequestSchema,
  UpdateRoomRequestSchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateRoomDto extends createZodDto(CreateRoomRequestSchema) {}
export class UpdateRoomDto extends createZodDto(UpdateRoomRequestSchema) {}
export class UpdateHousekeepingDto extends createZodDto(UpdateHousekeepingRequestSchema) {}
export class CreateRoomBlockDto extends createZodDto(CreateRoomBlockRequestSchema) {}
