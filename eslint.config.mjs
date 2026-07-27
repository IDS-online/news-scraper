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
  {
    // Vendored shadcn/ui components are copy-pasted upstream code we don't
    // author or govern with our own lint rules (see .claude/rules/frontend.md).
    // Relax the React purity checks that fire on their internal patterns
    // (e.g. Math.random() in the sidebar skeleton).
    files: ['src/components/ui/**'],
    rules: {
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]

export default eslintConfig
