import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  // KHÔNG clean ở watch mode: xoá dist lúc start làm consumer (nest tsc-watch)
  // mất .d.ts đúng khoảnh khắc compile → lỗi TS7016 dính. Build một-lần dùng --clean.
  clean: false,
});
