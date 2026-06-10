import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { base } from './index.mjs';

/** Flat config cho app/package React (Next.js, @pms/ui). */
export const react = [
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
];

export default react;
