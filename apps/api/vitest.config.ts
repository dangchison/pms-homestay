import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest + SWC: esbuild (mặc định của vitest) KHÔNG hỗ trợ emitDecoratorMetadata
 * → DI của NestJS hỏng. unplugin-swc là điểm validate tuần 1 theo docs/01.
 * test/di-smoke.spec.ts là gate chứng minh metadata hoạt động.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        // KHÔNG khai báo baseUrl/paths ở đây — alias do resolve.alias của Vitest
        // đảm nhiệm; SWC chỉ transpile (baseUrl tương đối làm SWC panic).
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@core': new URL('./src/core', import.meta.url).pathname,
      '@modules': new URL('./src/modules', import.meta.url).pathname,
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
