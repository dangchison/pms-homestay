import { OffsetPaginationQuerySchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

/** Query phân trang offset dùng chung cho danh sách nhỏ (docs/05 §pagination). */
export class OffsetPaginationQueryDto extends createZodDto(OffsetPaginationQuerySchema) {}

/** page/page_size → skip/take cho Prisma. */
export function offsetToSkipTake(query: { page: number; page_size: number }): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.page_size, take: query.page_size };
}
