import {
  CreateAssetRequestSchema,
  DisposeAssetRequestSchema,
  OffsetPaginationQuerySchema,
  UpdateAssetRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateAssetDto extends createZodDto(CreateAssetRequestSchema) {}
export class UpdateAssetDto extends createZodDto(UpdateAssetRequestSchema) {}
export class DisposeAssetDto extends createZodDto(DisposeAssetRequestSchema) {}

/** Danh sách tài sản theo cơ sở (property_id bắt buộc — RBAC pha-2 theo property). */
const AssetListQuerySchema = OffsetPaginationQuerySchema.extend({
  property_id: z.uuid(),
});
export class AssetListQueryDto extends createZodDto(AssetListQuerySchema) {}
