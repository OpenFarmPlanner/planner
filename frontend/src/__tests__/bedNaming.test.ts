import { describe, expect, it } from 'vitest';
import {
  abbreviateNameList,
  buildBedNameSeries,
  incrementName,
  nextFreeName,
  suggestBedCountAcrossWidth,
} from '../components/hierarchy/utils/bedNaming';

describe('incrementName', () => {
  it.each([
    ['E 2 8', 'E 2 9'],
    ['Beet 09', 'Beet 10'],
    ['B-3', 'B-4'],
    ['Beet 9', 'Beet 10'],
    ['Beet 007', 'Beet 008'],
    ['Beet 099', 'Beet 100'],
    ['99', '100'],
    ['Reihe 3a', 'Reihe 4a'],
    ['Beet_1_x', 'Beet_2_x'],
  ])('increments the last number of %s to %s', (name, expected) => {
    expect(incrementName(name)).toBe(expected);
  });

  it('appends " 2" to a name without a number', () => {
    expect(incrementName('Nordbeet')).toBe('Nordbeet 2');
  });

  it('only increments the last of several numbers', () => {
    expect(incrementName('2024 Feld 3 Beet 12')).toBe('2024 Feld 3 Beet 13');
    expect(incrementName('E 1 1')).toBe('E 1 2');
  });

  it('keeps the width of leading zeros and grows past it', () => {
    expect(incrementName('A 01')).toBe('A 02');
    expect(incrementName('A 9')).toBe('A 10');
    expect(incrementName('A 0009')).toBe('A 0010');
  });

  it('handles very long numbers without precision loss', () => {
    expect(incrementName('Beet 9007199254740993')).toBe('Beet 9007199254740994');
  });

  it('ignores surrounding whitespace', () => {
    expect(incrementName('  Beet 4  ')).toBe('Beet 5');
  });

  it('starts at 1 for an empty name', () => {
    expect(incrementName('')).toBe('1');
  });
});

describe('nextFreeName', () => {
  it('returns the incremented name when it is free', () => {
    expect(nextFreeName('Beet 1', ['Beet 1'])).toBe('Beet 2');
  });

  it('keeps incrementing past taken names', () => {
    expect(nextFreeName('Beet 1', ['Beet 1', 'Beet 2', 'Beet 3'])).toBe('Beet 4');
    expect(nextFreeName('Nordbeet', ['Nordbeet', 'Nordbeet 2', 'Nordbeet 3'])).toBe('Nordbeet 4');
    expect(nextFreeName('Beet 09', ['Beet 10', 'Beet 11'])).toBe('Beet 12');
  });

  it('compares taken names trimmed', () => {
    expect(nextFreeName('B-3', [' B-4 '])).toBe('B-5');
  });
});

describe('buildBedNameSeries', () => {
  it('counts the last number of the first name up', () => {
    expect(buildBedNameSeries('E 2 1', 3)).toEqual(['E 2 1', 'E 2 2', 'E 2 3']);
    expect(buildBedNameSeries('pre_1', 3)).toEqual(['pre_1', 'pre_2', 'pre_3']);
    expect(buildBedNameSeries('Beet 09', 2)).toEqual(['Beet 09', 'Beet 10']);
  });

  it('appends a number to a name without one', () => {
    expect(buildBedNameSeries('Nordbeet', 3)).toEqual(['Nordbeet', 'Nordbeet 2', 'Nordbeet 3']);
  });

  it('trims the first name', () => {
    expect(buildBedNameSeries('  E 1 ', 2)).toEqual(['E 1', 'E 2']);
  });

  it('is empty without a first name or count', () => {
    expect(buildBedNameSeries('', 3)).toEqual([]);
    expect(buildBedNameSeries('   ', 3)).toEqual([]);
    expect(buildBedNameSeries('E 1', 0)).toEqual([]);
  });
});

describe('suggestBedCountAcrossWidth', () => {
  it('fits beds and paths across the field width', () => {
    // 10 m field, 1.2 m beds, 0.4 m paths: floor(10.4 / 1.6) = 6.
    expect(suggestBedCountAcrossWidth(10, 1.2, 0.4)).toBe(6);
    expect(suggestBedCountAcrossWidth(10, 1, 0)).toBe(10);
  });

  it('does not lose a bed to floating-point error', () => {
    expect(suggestBedCountAcrossWidth(3, 0.9, 0.3)).toBe(2);
    expect(suggestBedCountAcrossWidth(3.3, 0.9, 0.3)).toBe(3);
  });

  it('returns 0 for missing or invalid input', () => {
    expect(suggestBedCountAcrossWidth(0, 1, 0)).toBe(0);
    expect(suggestBedCountAcrossWidth(10, 0, 0)).toBe(0);
    expect(suggestBedCountAcrossWidth(10, 1, -1)).toBe(0);
  });
});

describe('abbreviateNameList', () => {
  it('keeps up to 12 names', () => {
    const names = Array.from({ length: 12 }, (_, index) => String(index + 1));
    expect(abbreviateNameList(names)).toEqual(names);
  });

  it('shows the first 6, an ellipsis and the last 3 beyond 12', () => {
    const names = Array.from({ length: 13 }, (_, index) => String(index + 1));
    expect(abbreviateNameList(names)).toEqual(['1', '2', '3', '4', '5', '6', '…', '11', '12', '13']);
  });
});
