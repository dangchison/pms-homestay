import {
  CreateChannelMappingRequestSchema,
  CreateChannelRequestSchema,
  UpdateChannelMappingRequestSchema,
  UpdateChannelRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateChannelDto extends createZodDto(CreateChannelRequestSchema) {}
export class UpdateChannelDto extends createZodDto(UpdateChannelRequestSchema) {}
export class CreateChannelMappingDto extends createZodDto(CreateChannelMappingRequestSchema) {}
export class UpdateChannelMappingDto extends createZodDto(UpdateChannelMappingRequestSchema) {}

/** GET /channels?property_id= (bắt buộc — RBAC pha-2 theo property). */
const ChannelListQuerySchema = z.object({ property_id: z.uuid() });
export class ChannelListQueryDto extends createZodDto(ChannelListQuerySchema) {}
