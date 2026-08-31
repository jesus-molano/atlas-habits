const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['android/**', 'coverage/**', 'dist/**', 'node_modules/**'],
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
        },
      },
    },
    rules: {
      'import/order': [
        'warn',
        {
          alphabetize: { order: 'asc' },
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
        },
      ],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]);
