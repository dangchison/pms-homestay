import { Prisma } from '@prisma/client';

/**
 * Model có soft-delete (cột deleted_at) — thêm dần khi migration tạo bảng mới:
 * properties, rooms, guests, rate_plans, assets (docs/05 §soft-delete).
 */
export const SOFT_DELETABLE_MODELS = new Set<string>(['users']);

function mentionsDeletedAt(where: unknown): boolean {
  return typeof where === 'object' && where !== null && 'deleted_at' in (where as object);
}

function injectLiveFilter(args: { where?: unknown }): void {
  if (!mentionsDeletedAt(args.where)) {
    args.where = { ...((args.where as object) ?? {}), deleted_at: null };
  }
}

/**
 * Default filter `deleted_at IS NULL` cho model soft-delete (task 1.6 —
 * Prisma Client Extension, KHÔNG dùng $use đã deprecated).
 *
 * - Caller chủ động đề cập deleted_at trong where (vd ?include_deleted=true,
 *   quyền audit — docs/05) thì extension KHÔNG can thiệp.
 * - findUnique không chèn được filter (unique input) — đường đọc theo id dùng
 *   findFirst({where: {id}}) khi cần tôn trọng soft-delete.
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete-default-filter',
  query: {
    $allModels: {
      findMany({ model, args, query }) {
        if (SOFT_DELETABLE_MODELS.has(model)) injectLiveFilter(args);
        return query(args);
      },
      findFirst({ model, args, query }) {
        if (SOFT_DELETABLE_MODELS.has(model)) injectLiveFilter(args);
        return query(args);
      },
      count({ model, args, query }) {
        if (SOFT_DELETABLE_MODELS.has(model)) injectLiveFilter(args as { where?: unknown });
        return query(args);
      },
      updateMany({ model, args, query }) {
        if (SOFT_DELETABLE_MODELS.has(model)) injectLiveFilter(args);
        return query(args);
      },
    },
  },
});
