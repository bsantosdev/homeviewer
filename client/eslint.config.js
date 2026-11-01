// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettier = require('eslint-config-prettier/flat');
const fs = require('node:fs');
const path = require('node:path');

// The folders under src/app/features. Each may use core/ and shared/, but not another feature.
const features = fs
  .readdirSync(path.join(__dirname, 'src/app/features'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const OTHER_FEATURE = (feature) => ({
  regex: `(^|/)(${features.filter((f) => f !== feature).join('|')})/`,
  message:
    'A feature may not import another feature. Compose features in a page such as dashboard/ or admin/.',
  allowTypeImports: true,
});
// Presentational components: data in through inputs, events out through outputs.
const SERVICE = {
  regex: '(/data-access/|/core/settings\\.service$)',
  message:
    'ui/ components are presentational: take data as inputs and emit outputs; the container talks to services.',
  allowTypeImports: true,
};

// ESLint keeps only the last options set for a rule, so each group of files gets all its patterns
// in one call.
/** Forbids imports that match any of `patterns`. */
function restrictImports(...patterns) {
  return { '@typescript-eslint/no-restricted-imports': ['error', { patterns }] };
}

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      angular.configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-signals': 'error',
      // Angular components and services are decorated classes that may be empty.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
    },
  },
  ...features.flatMap((feature) => [
    {
      files: [`src/app/features/${feature}/**/*.ts`],
      ignores: ['**/*.spec.ts'],
      rules: restrictImports(OTHER_FEATURE(feature)),
    },
    {
      files: [`src/app/features/${feature}/ui/**/*.ts`],
      ignores: ['**/*.spec.ts'],
      rules: restrictImports(OTHER_FEATURE(feature), SERVICE),
    },
  ]),
  {
    files: ['src/app/shared/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: restrictImports({
      regex: '(^|/)(features/|core/settings\\.service$)',
      message: 'shared/ holds reusable UI that knows nothing about the features or the settings.',
    }),
  },
  prettier,
]);
