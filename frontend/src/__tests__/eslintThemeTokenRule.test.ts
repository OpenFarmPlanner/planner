import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import rule from '../../eslint-rules/no-hardcoded-style-values.js';

const linter = new Linter();
const config: Parameters<Linter['verify']>[1][number] = {
  files: ['**/*.jsx'],
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { 'theme-tokens': { rules: { 'no-hardcoded-style-values': rule } } },
  rules: { 'theme-tokens/no-hardcoded-style-values': 'error' },
};

const lint = (source: string) => linter.verify(source, [config], { filename: 'component.jsx' });

describe('no-hardcoded-style-values', () => {
  it('reports colors, off-grid pixel spacing, nested fallbacks, and SVG colors', () => {
    const messages = lint(`
      const sx = {
        color: '#123456',
        padding: '10px 16px',
        mx: 'calc(100% - 12px)',
        mt: '-2px',
        borderRadius: '16px 16px 0 0',
        borderTopLeftRadius: '8px',
        backgroundColor: customColor || 'rgba(0, 0, 0, 0.5)',
      };
      const icon = <path fill="#abcdef" stroke={'#123'} />;
    `);

    expect(messages).toHaveLength(9);
    expect(messages.every((message) => (
      message.ruleId === 'theme-tokens/no-hardcoded-style-values'
    ))).toBe(true);
  });

  it('allows theme tokens, numeric spacing units, and domain color data', () => {
    const messages = lint(`
      const sx = {
        color: 'text.primary',
        padding: 2,
        borderRadius: theme.shape.borderRadius,
        backgroundColor: theme.palette.background.paper,
      };
      const icon = <path fill={crop.color} stroke="currentColor" />;
    `);

    expect(messages).toEqual([]);
  });
});
