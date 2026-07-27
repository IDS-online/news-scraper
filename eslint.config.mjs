import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

/**
 * ESLint flat config (ESLint 9 + Next.js 16).
 * Replaces the removed `next lint` command — run with `npm run lint`.
 */
const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'build/**', 'next-env.d.ts'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
]

export default eslintConfig
