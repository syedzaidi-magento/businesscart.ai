// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';

export default [
    {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'build/**',
      '**/*.d.ts',
      'vite.config.ts'
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
    },
    rules: {
      // Base rules
      eqeqeq: 'error',
      'no-console': 'warn',
      semi: ['error', 'always'],
      quotes: ['error', 'single'],

      // TypeScript-specific rules
      '@typescript-eslint/no-explicit-any': 'warn',

      // React rules:
      'react/jsx-uses-react': 'off', // for React 17+
      'react/react-in-jsx-scope': 'off', // for React 17+
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
];
