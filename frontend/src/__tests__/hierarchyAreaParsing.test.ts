import {
  normalizeAreaValue,
  parseAreaExpression,
  parseAreaValue,
  parseDimensionValue,
} from '../components/hierarchy/utils/hierarchyAreaParsing';

describe('parseAreaExpression', () => {
  it('reads a plain number', () => {
    expect(parseAreaExpression('12')).toBe(12);
    expect(parseAreaExpression('12.5')).toBe(12.5);
  });

  it('accepts the German decimal comma', () => {
    expect(parseAreaExpression('12,5')).toBe(12.5);
  });

  it('multiplies out a bed measured as length by width', () => {
    expect(parseAreaExpression('10*2')).toBe(20);
    expect(parseAreaExpression('10 x 2')).toBe(20);
    expect(parseAreaExpression('10 × 2')).toBe(20);
    expect(parseAreaExpression('10 X 2')).toBe(20);
  });

  it('multiplies more than two factors', () => {
    expect(parseAreaExpression('2*3*4')).toBe(24);
  });

  it('combines commas and multiplication', () => {
    expect(parseAreaExpression('1,5 x 2,5')).toBe(3.75);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseAreaExpression('  7  ')).toBe(7);
  });

  it('returns undefined for empty input', () => {
    expect(parseAreaExpression('')).toBeUndefined();
    expect(parseAreaExpression('   ')).toBeUndefined();
  });

  it('rejects anything that is not a bare number, rather than guessing', () => {
    expect(parseAreaExpression('10 m²')).toBeUndefined();
    expect(parseAreaExpression('zehn')).toBeUndefined();
    expect(parseAreaExpression('10+2')).toBeUndefined();
    expect(parseAreaExpression('1e3')).toBeUndefined();
  });

  it('rejects a negative area, since a bed cannot have one', () => {
    expect(parseAreaExpression('-5')).toBeUndefined();
    expect(parseAreaExpression('10 * -2')).toBeUndefined();
  });

  it('rejects a factor that is not a number even when the others are', () => {
    expect(parseAreaExpression('10 x abc')).toBeUndefined();
  });

  it('drops empty factors from a trailing or doubled operator', () => {
    expect(parseAreaExpression('10*')).toBe(10);
    expect(parseAreaExpression('10**2')).toBe(20);
  });

  it('returns undefined when only operators were typed', () => {
    expect(parseAreaExpression('***')).toBeUndefined();
  });

  it('keeps full precision rather than rounding', () => {
    expect(parseAreaExpression('1,05 x 3')).toBeCloseTo(3.15, 10);
  });
});

describe('normalizeAreaValue', () => {
  it('rounds to one decimal, which is the precision the form stores', () => {
    expect(normalizeAreaValue(3.14159)).toBe(3.1);
    expect(normalizeAreaValue(3.15)).toBe(3.2);
    expect(normalizeAreaValue(3.14)).toBe(3.1);
  });

  it('leaves a value that is already one decimal alone', () => {
    expect(normalizeAreaValue(20)).toBe(20);
    expect(normalizeAreaValue(20.5)).toBe(20.5);
  });

  it('rounds a negative value away from zero at the half', () => {
    expect(normalizeAreaValue(-3.15)).toBe(-3.1);
  });

  it('passes undefined and non-finite values through as undefined', () => {
    expect(normalizeAreaValue(undefined)).toBeUndefined();
    expect(normalizeAreaValue(Number.NaN)).toBeUndefined();
    expect(normalizeAreaValue(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('keeps zero, which is a real value and not "unset"', () => {
    expect(normalizeAreaValue(0)).toBe(0);
  });
});

describe('parseAreaValue', () => {
  it('takes a number straight through without parsing it', () => {
    expect(parseAreaValue(20)).toBe(20);
    expect(parseAreaValue(0)).toBe(0);
    expect(parseAreaValue(-5)).toBe(-5);
  });

  it('rejects a non-finite number', () => {
    expect(parseAreaValue(Number.NaN)).toBeUndefined();
    expect(parseAreaValue(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('parses a string through the expression parser', () => {
    expect(parseAreaValue('10 x 2')).toBe(20);
    expect(parseAreaValue('unsinn')).toBeUndefined();
  });

  it('treats an empty or blank string as no value', () => {
    expect(parseAreaValue('')).toBeUndefined();
    expect(parseAreaValue('   ')).toBeUndefined();
  });

  it('treats undefined as no value', () => {
    expect(parseAreaValue(undefined)).toBeUndefined();
  });
});

describe('parseDimensionValue', () => {
  it('distinguishes "cleared" from "not understood"', () => {
    // null means the user emptied the field; undefined means the input could
    // not be read, and the caller must not overwrite the stored value with it.
    expect(parseDimensionValue('')).toBeNull();
    expect(parseDimensionValue('   ')).toBeNull();
    expect(parseDimensionValue(null)).toBeNull();
    expect(parseDimensionValue('unsinn')).toBeUndefined();
    expect(parseDimensionValue(undefined)).toBeUndefined();
  });

  it('reads a number straight through', () => {
    expect(parseDimensionValue(2.5)).toBe(2.5);
    expect(parseDimensionValue(0)).toBe(0);
  });

  it('rejects a non-finite number', () => {
    expect(parseDimensionValue(Number.NaN)).toBeUndefined();
  });

  it('accepts the German decimal comma', () => {
    expect(parseDimensionValue('2,5')).toBe(2.5);
  });

  it('accepts a negative dimension, unlike an area expression', () => {
    expect(parseDimensionValue('-2.5')).toBe(-2.5);
  });

  it('reads the leading number of a value carrying a unit', () => {
    // parseFloat stops at the first non-numeric character, so "2,5 m" is a
    // dimension of 2.5 rather than a rejected input.
    expect(parseDimensionValue('2,5 m')).toBe(2.5);
  });
});
