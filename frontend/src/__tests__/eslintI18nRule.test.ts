import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import rule from '../../eslint-rules/no-hardcoded-ui-strings.js';

const linter = new Linter();
const config: Parameters<Linter['verify']>[1][number] = {
  files: ['**/*.jsx'],
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { i18n: { rules: { 'no-hardcoded-ui-strings': rule } } },
  rules: { 'i18n/no-hardcoded-ui-strings': 'error' },
};

const lint = (source: string) => linter.verify(source, [config], { filename: 'component.jsx' });

describe('no-hardcoded-ui-strings', () => {
  it('reports visible JSX text, attributes, and alternate render branches', () => {
    const messages = lint(`
      const view = <>
        <p>Untranslated text</p>
        <input aria-label="Untranslated label" />
        <input aria-description="Untranslated description" aria-valuetext="Untranslated value" />
        <section aria-roledescription="Untranslated region" />
        <img alt="Untranslated alternative" />
        <span>{ready ? 'Ready' : \`Waiting for \${name}\`}</span>
      </>;
    `);

    expect(messages.map((message) => message.ruleId)).toEqual([
      'i18n/no-hardcoded-ui-strings',
      'i18n/no-hardcoded-ui-strings',
      'i18n/no-hardcoded-ui-strings',
      'i18n/no-hardcoded-ui-strings',
      'i18n/no-hardcoded-ui-strings',
      'i18n/no-hardcoded-ui-strings',
      'i18n/no-hardcoded-ui-strings',
      'i18n/no-hardcoded-ui-strings',
    ]);
  });

  it('allows translated copy and ignores non-visible discriminator attributes', () => {
    const messages = lint(`
      const view = <section data-mode={mode === 'ready' ? 'complete' : 'pending'}>
        {enabled && t('status.ready')}
        <a href={path || '/fallback'} title={t('actions.open')}><img alt="" /></a>
      </section>;
    `);

    expect(messages).toEqual([]);
  });
});
