import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  // KHÔNG clean ở watch mode (xem ghi chú ở shared-types/tsup.config.ts)
  clean: false,
});
