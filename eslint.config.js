import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist', 'node_modules'],
  },
  ...tseslint.configs.strict.map((config) => ({
    ...config,
    files: ['src/**/*.ts'],
    rules: {
      ...config.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true },
      ],
      'no-console': [
        'error',
        {
          allow: ['warn', 'error'],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Property[key.name="responseSchema"]',
          message:
            'ADR-0001: never set responseSchema — belt-and-suspenders contracts only; see docs/adr/0001',
        },
      ],
    },
  })),
];
