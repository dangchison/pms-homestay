import base from '@pms/eslint-config';
import tenancy from '@pms/eslint-config/tenancy';

export default [
  ...base,
  tenancy,
  {
    rules: {
      // NestJS DI: class import chỉ xuất hiện ở vị trí type (constructor param)
      // nhưng emitDecoratorMetadata cần import THẬT — auto-fix sang `import type`
      // sẽ phá DI. Tắt rule này riêng cho api.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
