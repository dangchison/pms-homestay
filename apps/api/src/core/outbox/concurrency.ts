/**
 * Chạy `fn` trên `items` với tối đa `limit` job song song (thay `p-map` — không
 * thêm dependency). Dùng cho dispatcher fan-out batch (docs/10 §3 concurrency 10):
 * không tuần tự từng event, cũng không bung hết một lúc.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const poolSize = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: poolSize }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}
