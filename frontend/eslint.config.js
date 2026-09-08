import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const themeTokenPlugin = {
  rules: {
    'no-hardcoded-style-values': {
      meta: { type: 'suggestion', schema: [], messages: { token: 'Use an MUI theme token or spacing unit instead of hardcoded style value {{value}}.' } },
      create(context) {
        const colorKeys = new Set(['color', 'backgroundColor', 'bgcolor', 'borderColor', 'boxShadow', 'textShadow', 'outline', 'border']);
        const spacingKeys = new Set(['padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap', 'rowGap', 'columnGap']);
        return {
          Literal(node) {
            if (typeof node.value !== 'string' || !node.parent || node.parent.type !== 'Property') return;
            const key = node.parent.key.type === 'Identifier' ? node.parent.key.name : node.parent.key.value;
            const propertyName = String(key);
            const hasLiteralColor = colorKeys.has(propertyName) && /(?:#[0-9a-f]{3,8}\b|rgba?\()/i.test(node.value);
            const hasPixelSpacing = spacingKeys.has(propertyName) && /(?:^|\s)\d+(?:\.\d+)?px(?:\s|$)/i.test(node.value);
            if (hasLiteralColor || hasPixelSpacing) {
              context.report({ node, messageId: 'token', data: { value: JSON.stringify(node.value) } });
            }
          },
        };
      },
    },
  },
};

export default defineConfig([
  // ESLint 10 no longer implicitly skips every dotfolder/build-cache
  // directory the way earlier versions did — `.vite`'s prebundled deps
  // (@mui_material.js etc.) started getting linted as plain JS and failing
  // with "rule not found" errors for rules this config never enables.
  // List every local build/tooling output explicitly instead of relying on
  // implicit defaults that can change across major versions.
  globalIgnores(['dist', 'dist-staging', 'dist-ssr', '.vite', 'coverage', 'mutation-report']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: { 'theme-tokens': themeTokenPlugin },
    rules: {
      // Kept at `warn` deliberately, so that `quality.sh` can treat every
      // remaining ESLint error as a build failure (see scripts/quality.sh).
      //
      // This rule arrived with eslint-plugin-react-hooks 7 and fires on
      // patterns this app cannot express any other way: loading data on
      // mount, consuming a `?create=1` / `?planId=` deep link and then
      // rewriting the URL, and restoring sidebar or column state from
      // localStorage. All three legitimately need an effect — none of them
      // can run during render — so promoting this to an error would mean
      // roughly twenty inline `eslint-disable` comments, which trains
      // everyone (people and coding agents alike) to reach for a suppression
      // instead of thinking.
      //
      // The genuine findings behind it — derived state that was being pushed
      // into state from an effect — were fixed rather than silenced. Revisit
      // this if the project adopts a data-fetching library, which would
      // remove most of what is left.
      'react-hooks/set-state-in-effect': 'warn',

      // Tooltips must go through AppTooltip so they hide themselves while a
      // context menu is open (see components/contextMenu/contextMenuOpenState.ts).
      // MUI's Tooltip has no idea about app context menus and would cover them.
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@mui/material',
            importNames: ['Tooltip'],
            message: "Use AppTooltip from 'components/AppTooltip' instead - it hides tooltips while a context menu is open.",
          },
          {
            name: '@mui/material/Tooltip',
            message: "Use AppTooltip from 'components/AppTooltip' instead - it hides tooltips while a context menu is open.",
          },
        ],
      }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/__tests__/**', 'src/gantt-chart/**', 'src/theme.ts'],
    rules: {
      // Legacy findings remain warnings until their theme-token migration is
      // complete; tests, the theme definition, and vendored Gantt sources are
      // excluded because literals are data or are authoritative there.
      'theme-tokens/no-hardcoded-style-values': 'warn',
    },
  },
  {
    // AppTooltip is the one place allowed to build on MUI's Tooltip.
    files: ['src/components/AppTooltip.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // Vendored from react-modern-gantt (see src/gantt-chart/README.md), which
    // was linted under its own, more lenient rule set. Keep that leniency
    // scoped to this directory instead of rewriting its switch statements.
    // The react-hooks entries are here for the same reason: they are the
    // React Compiler rules that arrived with eslint-plugin-react-hooks 7 and
    // fire on the library's existing code, which this repository does not
    // maintain.
    files: ['src/gantt-chart/**/*.{ts,tsx}'],
    rules: {
      'no-case-declarations': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
])
