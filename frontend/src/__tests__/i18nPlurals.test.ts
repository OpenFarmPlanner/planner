/**
 * Plural forms are selected by i18next through `Intl.PluralRules`, never by
 * hand-written `count === 1` checks. French and Spanish differ from German
 * and English: French treats 0 as singular, and both use a separate "many"
 * category for large round numbers. These tests pin the rendered text for
 * the counts where the languages diverge.
 */

import { describe, expect, it } from 'vitest';

import i18n from '../i18n/config';

const COUNTS = [0, 1, 2, 1_000_000] as const;

function render(language: string, key: string, count: number): string {
  return i18n.getFixedT(language, 'plantingPlans')(key, { count });
}

describe('Intl plural categories', () => {
  it('selects the expected category per language', () => {
    const categories = (language: string): string[] =>
      COUNTS.map((count) => new Intl.PluralRules(language).select(count));

    expect(categories('de')).toEqual(['other', 'one', 'other', 'other']);
    expect(categories('en')).toEqual(['other', 'one', 'other', 'other']);
    expect(categories('fr')).toEqual(['one', 'one', 'other', 'many']);
    expect(categories('es')).toEqual(['other', 'one', 'other', 'many']);
  });
});

describe('plural texts', () => {
  it.each([
    ['de', ['0 Anbaupläne', '1 Anbauplan', '2 Anbaupläne', '1000000 Anbaupläne']],
    ['en', ['0 planting plans', '1 planting plan', '2 planting plans', '1000000 planting plans']],
    ['fr', ['0 série', '1 série', '2 séries', '1000000 séries']],
    ['es', ['0 series', '1 serie', '2 series', '1000000 series']],
  ])('renders search.count in %s for 0, 1, 2 and 1000000', (language, expected) => {
    expect(COUNTS.map((count) => render(language, 'search.count', count))).toEqual(expected);
  });

  it.each(['fr', 'es'])('never falls back to another language for large counts in %s', (language) => {
    const fallback = render('en', 'search.count', 1_000_000);
    expect(render(language, 'search.count', 1_000_000)).not.toBe(fallback);
  });
});
