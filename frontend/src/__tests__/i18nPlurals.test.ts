/**
 * Plural forms are selected by i18next through `Intl.PluralRules`, never by
 * hand-written `count === 1` checks. French and Spanish differ from German
 * and English: French treats 0 as singular, and both use a separate "many"
 * category for large round numbers. These tests pin the rendered text for
 * the counts where the languages diverge.
 */

import { describe, expect, it } from 'vitest';

import i18n from '../i18n/config';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';

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
    expect(categories('it-IT')).toEqual(['other', 'one', 'other', 'many']);
    expect(categories('pt-PT')).toEqual(['other', 'one', 'other', 'many']);
    expect(categories('nl-NL')).toEqual(['other', 'one', 'other', 'other']);
  });

  it('uses pt-PT rules for the pt bundle, including zero and fractional counts', () => {
    const rule = i18n.services.pluralResolver.getRule('pt') as Intl.PluralRules;
    expect(rule.resolvedOptions().locale).toBe('pt-PT');
    expect([0, 0.5, 1, 2, 1_000_000].map(count => rule.select(count)))
      .toEqual(['other', 'other', 'one', 'other', 'many']);
    expect(new Intl.PluralRules('pt').select(0)).toBe('one');
  });
});

describe('plural texts', () => {
  it.each([
    ['de', ['0 Anbaupläne', '1 Anbauplan', '2 Anbaupläne', '1000000 Anbaupläne']],
    ['en', ['0 planting plans', '1 planting plan', '2 planting plans', '1000000 planting plans']],
    ['fr', ['0 série', '1 série', '2 séries', '1000000 séries']],
    ['es', ['0 series', '1 serie', '2 series', '1000000 series']],
    ['it', ['0 serie', '1 serie', '2 serie', '1000000 serie']],
    ['pt', ['0 séries', '1 série', '2 séries', '1000000 séries']],
    ['nl', ['0 teelten', '1 teelt', '2 teelten', '1000000 teelten']],
  ])('renders search.count in %s for 0, 1, 2 and 1000000', (language, expected) => {
    expect(COUNTS.map((count) => render(language, 'search.count', count))).toEqual(expected);
  });

  it.each(['fr', 'es', 'it', 'pt'])('never falls back to another language for large counts in %s', (language) => {
    const fallback = render('en', 'search.count', 1_000_000);
    expect(render(language, 'search.count', 1_000_000)).not.toBe(fallback);
  });

  it.each([
    ['de', '1 vorgeschlagenen Beet', '2 vorgeschlagenen Beeten'],
    ['en', '1 proposed bed', '2 proposed beds'],
    ['fr', '1 planche proposée', '2 planches proposées'],
    ['es', '1 bancal propuesto', '2 bancales propuestos'],
    ['it', '1 aiuola proposta', '2 aiuole proposte'],
    ['pt', '1 canteiro proposto', '2 canteiros propostos'],
    ['nl', '1 voorgesteld bed', '2 voorgestelde bedden'],
  ])('pluralizes the accessible bed layout label in %s', (language, one, other) => {
    const t = i18n.getFixedT(language, 'hierarchy');
    expect(t('dialogs.bulkCreateBeds.layoutGraphic', { count: 1 }).endsWith(one)).toBe(true);
    expect(t('dialogs.bulkCreateBeds.layoutGraphic', { count: 2 }).endsWith(other)).toBe(true);
  });

  it.each(SUPPORTED_LANGUAGES.map(({ code }) => code))('localizes the season preview counts in %s', language => {
    const hierarchy = i18n.getFixedT(language, 'hierarchy');
    const navigation = i18n.getFixedT(language, 'navigation');
    const assignments = COUNTS.slice(1).map(count => hierarchy('parcelRotation.mappingCount', {
      count, formatted: new Intl.NumberFormat(language).format(count),
    }));
    const warnings = COUNTS.map(count => navigation('seasonSwitcher.copyDialog.rotation.remainingConflictCount', { count }));
    expect(assignments[0]).toContain('1');
    expect(assignments[1]).toContain('2');
    expect(assignments[0].replace('1', '')).not.toBe(assignments[1].replace('2', ''));
    expect(assignments[2]).toContain(new Intl.NumberFormat(language).format(1_000_000));
    warnings.forEach((label, index) => expect(label).toContain(String(COUNTS[index])));
  });
});
