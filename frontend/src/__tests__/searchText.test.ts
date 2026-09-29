import { describe, expect, it } from 'vitest';

import {
  buildMatchExcerpt,
  findMatchRanges,
  normalizeSearchText,
  textContainsTerm,
  tokenizeSearchQuery,
} from '../search/searchText';

describe('normalizeSearchText', () => {
  it('ignores case and diacritics', () => {
    expect(normalizeSearchText('Rübe')).toBe('rube');
    expect(normalizeSearchText('RÜBE')).toBe('rube');
    expect(normalizeSearchText('Crème Brûlée')).toBe('creme brulee');
  });

  it('treats ß as ss', () => {
    expect(normalizeSearchText('Straße')).toBe('strasse');
    expect(normalizeSearchText('STRAẞE')).toBe('strasse');
  });

  it('normalizes decomposed umlauts like composed ones', () => {
    expect(normalizeSearchText('Rübe')).toBe('rube');
  });
});

describe('tokenizeSearchQuery', () => {
  it('splits on whitespace, normalizes and de-duplicates terms', () => {
    expect(tokenizeSearchQuery('  Rübe   HOFGARTEN rube ')).toEqual(['rube', 'hofgarten']);
  });

  it('returns no terms for a blank query', () => {
    expect(tokenizeSearchQuery('   ')).toEqual([]);
  });
});

describe('textContainsTerm', () => {
  it('matches inside words with normalization', () => {
    expect(textContainsTerm('Rote Rübe', 'rube')).toBe(true);
    expect(textContainsTerm('Großbeet', 'rossb')).toBe(true);
    expect(textContainsTerm(null, 'x')).toBe(false);
  });
});

describe('findMatchRanges', () => {
  it('marks matches in the middle of a word', () => {
    expect(findMatchRanges('Karotte', ['rot'])).toEqual([{ start: 2, end: 5 }]);
  });

  it('maps normalized matches back to the original characters', () => {
    const text = 'Rote Rübe';
    const [range] = findMatchRanges(text, ['rube']);
    expect(text.slice(range.start, range.end)).toBe('Rübe');
  });

  it('handles ß expanding to two characters', () => {
    const text = 'Großbeet Süd';
    const ranges = findMatchRanges(text, ['ss']);
    expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual(['ß']);
    const [partial] = findMatchRanges(text, ['ossb']);
    expect(text.slice(partial.start, partial.end)).toBe('oßb');
  });

  it('keeps a decomposed combining mark inside the mark', () => {
    const text = 'Rübe';
    const [range] = findMatchRanges(text, ['ru']);
    expect(text.slice(range.start, range.end)).toBe('Rü');
  });

  it('merges overlapping ranges of several terms', () => {
    expect(findMatchRanges('Tomatenreihe', ['tomat', 'maten'])).toEqual([{ start: 0, end: 7 }]);
    expect(findMatchRanges('Beet 1 Beet 2', ['beet'])).toEqual([
      { start: 0, end: 4 },
      { start: 7, end: 11 },
    ]);
  });

  it('returns nothing without terms or text', () => {
    expect(findMatchRanges('Tomate', [])).toEqual([]);
    expect(findMatchRanges('', ['tomate'])).toEqual([]);
  });
});

describe('buildMatchExcerpt', () => {
  it('keeps short text unchanged on one line', () => {
    expect(buildMatchExcerpt('Mit Vlies\nabdecken', ['vlies'])).toBe('Mit Vlies abdecken');
  });

  it('centres long text on the first hit', () => {
    const text = `${'a'.repeat(200)} Vlies ${'b'.repeat(200)}`;
    const excerpt = buildMatchExcerpt(text, ['vlies'], 60);
    expect(excerpt).toContain('Vlies');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('starts at the beginning without a hit', () => {
    const excerpt = buildMatchExcerpt('x'.repeat(200), ['vlies'], 50);
    expect(excerpt.startsWith('x')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});
