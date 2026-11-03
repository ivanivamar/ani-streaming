// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const boundaries = require('eslint-plugin-boundaries');

/**
 * Layer rules (PLAN.md "Architecture rules"):
 *   ui → application → domain; infrastructure implements domain/application ports;
 *   domain has no Angular/Firebase/RxJS imports; contexts talk to each other only through
 *   their application/ public API.
 */
const LAYERS = ['domain', 'application', 'infrastructure', 'ui'];
const sameContext = (type) => ({
  element: { type, captured: { context: '{{ from.element.captured.context }}' } },
});

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
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
    },
  },
  {
    files: ['src/**/*.ts', 'packages/*/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: { project: 'tsconfig.json' },
      },
      'boundaries/legacy-templates': false,
      'boundaries/include': ['src/**/*', 'packages/*/src/**/*'],
      'boundaries/ignore': ['src/main.ts'],
      'boundaries/elements': [
        ...LAYERS.map((layer) => ({
          type: layer,
          pattern: `src/app/contexts/*/${layer}`,
          capture: ['context'],
        })),
        { type: 'shared-kernel', pattern: 'src/app/shared/kernel' },
        { type: 'shared-ui', pattern: 'src/app/shared/ui' },
        { type: 'shared-infrastructure', pattern: 'src/app/shared/infrastructure' },
        { type: 'shell', pattern: 'src/app/shell' },
        { type: 'contracts', pattern: 'packages/contracts/src' },
        // Last on purpose: the rest of src/app (app.ts, app.config.ts, app.routes.ts) is the
        // composition root. src/main.ts is ignored (it only bootstraps App).
        { type: 'app', pattern: 'src/app' },
      ],
    },
    rules: {
      'boundaries/no-unknown-files': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkAllOrigins: true,
          policies: [
            // npm packages: everyone except domain, kernel and contracts.
            {
              from: {
                element: {
                  types: [
                    'application',
                    'infrastructure',
                    'ui',
                    'shared-ui',
                    'shared-infrastructure',
                    'shell',
                    'app',
                  ],
                },
              },
              allow: { to: { module: { origin: ['external', 'core'] } } },
            },
            {
              from: { element: { types: ['domain', 'shared-kernel', 'contracts'] } },
              allow: { to: { module: { origin: 'external', source: ['@ani/contracts'] } } },
            },
            {
              from: { element: { type: 'domain' } },
              allow: [sameContext('domain'), { element: { types: ['shared-kernel'] } }].map((to) => ({ to })),
            },
            {
              from: { element: { type: 'application' } },
              allow: [
                sameContext('domain'),
                { element: { type: 'application' } },
                { element: { type: 'shared-kernel' } },
              ].map((to) => ({ to })),
            },
            {
              from: { element: { type: 'infrastructure' } },
              allow: [
                sameContext('domain'),
                sameContext('application'),
                sameContext('infrastructure'),
                { element: { types: ['shared-kernel', 'shared-infrastructure', 'contracts'] } },
              ].map((to) => ({ to })),
            },
            {
              from: { element: { type: 'ui' } },
              allow: [
                sameContext('application'),
                sameContext('ui'),
                { element: { types: ['shared-ui', 'shared-kernel'] } },
              ].map((to) => ({ to })),
            },
            {
              from: { element: { type: 'shared-kernel' } },
              allow: { to: { element: { types: ['shared-kernel', 'contracts'] } } },
            },
            {
              from: { element: { type: 'shared-ui' } },
              allow: { to: { element: { types: ['shared-ui', 'shared-kernel'] } } },
            },
            {
              from: { element: { type: 'shared-infrastructure' } },
              allow: {
                to: { element: { types: ['shared-infrastructure', 'shared-kernel', 'contracts'] } },
              },
            },
            {
              from: { element: { type: 'shell' } },
              allow: {
                to: { element: { types: ['shell', 'application', 'shared-ui', 'shared-kernel'] } },
              },
            },
            {
              from: { element: { type: 'contracts' } },
              allow: { to: { element: { type: 'contracts' } } },
            },
            // Composition root: app config/routes may wire any context's ui routes and providers.
            {
              from: { element: { type: 'app' } },
              allow: {
                to: {
                  element: {
                    types: ['app', 'shell', 'ui', 'infrastructure', 'shared-ui', 'shared-infrastructure', 'shared-kernel'],
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
