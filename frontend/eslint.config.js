// ESLint: TypeScript, React hooks, JSDoc comments and security patterns.
// JSDoc here is descriptive prose, so the rules that demand @param and @returns tags are off;
// detect-object-injection flags every typed lookup by key and is off as well.
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsdoc from 'eslint-plugin-jsdoc'
import security from 'eslint-plugin-security'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  jsdoc.configs['flat/recommended-typescript'],
  security.configs.recommended,
  { plugins: { 'react-hooks': reactHooks }, rules: reactHooks.configs.recommended.rules },
  {
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'security/detect-object-injection': 'off',
    },
  },
)
