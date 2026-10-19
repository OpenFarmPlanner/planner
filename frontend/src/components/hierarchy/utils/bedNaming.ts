/**
 * Bed name generation shared by "Beet hinzufügen", "Beet duplizieren" and
 * the "Mehrere Beete anlegen" dialog. Bed names are unique per field
 * (backend constraint), so every generator here skips names already taken.
 */

const LAST_NUMBER_PATTERN = /^(.*?)(\d+)(\D*)$/;
const SEQUENTIAL_NAME_PATTERN = /^(?:(.*\S)\s+)?(\d+)$/;
const ROW_BED_NAME_PATTERN = /^(?:(.*\S)\s+)?(\d+)\s+(\d+)$/;

/** Upper bound for one "Mehrere Beete anlegen" run; mirrors the backend limit. */
export const MAX_BULK_BED_COUNT = 200;

/**
 * Increments the last number in `name`, keeping everything around it
 * (separators, spaces, leading zeros): "E 2 8" → "E 2 9", "Beet 09" →
 * "Beet 10", "B-3" → "B-4". A name without a number gets " 2" appended
 * ("Nordbeet" → "Nordbeet 2").
 */
export function incrementName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    return '1';
  }

  const match = LAST_NUMBER_PATTERN.exec(trimmed);
  if (!match) {
    return `${trimmed} 2`;
  }

  const [, head, digits, tail] = match;
  const next = String(BigInt(digits) + 1n).padStart(digits.length, '0');
  return `${head}${next}${tail}`;
}

/** Increments `name` until the result is not in `takenNames`. */
export function nextFreeName(name: string, takenNames: Iterable<string>): string {
  const taken = new Set(Array.from(takenNames, (takenName) => takenName.trim()));
  let candidate = incrementName(name);
  while (taken.has(candidate)) {
    candidate = incrementName(candidate);
  }
  return candidate;
}

/** Joins a prefix and numbers with single spaces; an empty prefix adds no leading space. */
export function joinBedName(prefix: string, ...numbers: number[]): string {
  const trimmedPrefix = prefix.trim();
  const numberPart = numbers.join(' ');
  return trimmedPrefix ? `${trimmedPrefix} ${numberPart}` : numberPart;
}

export interface SequentialNamingOptions {
  prefix: string;
  start: number;
  count: number;
}

export interface RowBedNamingOptions {
  prefix: string;
  rows: number;
  bedsPerRow: number;
  firstRow: number;
  firstBed: number;
}

/** "E 1", "E 2", … */
export function buildSequentialBedNames({ prefix, start, count }: SequentialNamingOptions): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => joinBedName(prefix, start + index));
}

/** "E 1 1" … "E 1 8", "E 2 1" … "E 2 8" (row-major). */
export function buildRowBedNames({
  prefix,
  rows,
  bedsPerRow,
  firstRow,
  firstBed,
}: RowBedNamingOptions): string[] {
  const names: string[] = [];
  for (let rowIndex = 0; rowIndex < Math.max(0, rows); rowIndex += 1) {
    for (let bedIndex = 0; bedIndex < Math.max(0, bedsPerRow); bedIndex += 1) {
      names.push(joinBedName(prefix, firstRow + rowIndex, firstBed + bedIndex));
    }
  }
  return names;
}

export type DetectedBedNaming =
  | { mode: 'sequential'; prefix: string; start: number }
  | { mode: 'rowBed'; prefix: string; firstRow: number; firstBed: number; bedsPerRow: number };

const hasSinglePrefix = (prefixes: readonly string[]): boolean => new Set(prefixes).size === 1;

/**
 * Recognizes the two naming schemes the bulk dialog generates and returns
 * start values that continue them seamlessly. Returns null unless every
 * name follows the same scheme with the same prefix. Row/bed wins when both
 * readings fit (e.g. a single row "E 1 1" … "E 1 8").
 */
export function detectBedNaming(names: readonly string[]): DetectedBedNaming | null {
  const trimmedNames = names.map((name) => name.trim()).filter((name) => name !== '');
  if (trimmedNames.length === 0) {
    return null;
  }

  const rowBedMatches = trimmedNames.map((name) => ROW_BED_NAME_PATTERN.exec(name));
  if (rowBedMatches.every((match) => match !== null)) {
    const parsed = rowBedMatches.map((match) => ({
      prefix: match![1] ?? '',
      row: Number(match![2]),
      bed: Number(match![3]),
    }));
    if (hasSinglePrefix(parsed.map((entry) => entry.prefix))) {
      const lastRow = Math.max(...parsed.map((entry) => entry.row));
      const lastRowBeds = parsed.filter((entry) => entry.row === lastRow);
      return {
        mode: 'rowBed',
        prefix: parsed[0].prefix,
        firstRow: lastRow + 1,
        firstBed: Math.min(...parsed.map((entry) => entry.bed)),
        bedsPerRow: lastRowBeds.length,
      };
    }
  }

  const sequentialMatches = trimmedNames.map((name) => SEQUENTIAL_NAME_PATTERN.exec(name));
  if (sequentialMatches.every((match) => match !== null)) {
    const parsed = sequentialMatches.map((match) => ({
      prefix: match![1] ?? '',
      number: Number(match![2]),
    }));
    if (hasSinglePrefix(parsed.map((entry) => entry.prefix))) {
      return {
        mode: 'sequential',
        prefix: parsed[0].prefix,
        start: Math.max(...parsed.map((entry) => entry.number)) + 1,
      };
    }
  }

  return null;
}

/**
 * How many beds of `bedWidth` fit side by side across `fieldWidth` with a
 * path of `pathWidth` between neighbours (no path outside the outer beds).
 */
export function suggestBedCountAcrossWidth(fieldWidth: number, bedWidth: number, pathWidth: number): number {
  if (!(fieldWidth > 0) || !(bedWidth > 0) || !(pathWidth >= 0)) {
    return 0;
  }
  // Rounded first so 0.1-step inputs such as (3 + 0.3) / (0.9 + 0.3) don't
  // lose a whole bed to floating-point error just below an integer.
  const ratio = Math.round(((fieldWidth + pathWidth) / (bedWidth + pathWidth)) * 1e9) / 1e9;
  return Math.floor(ratio);
}

/** First 6, "…", last 3 once a preview exceeds 12 names. */
export function abbreviateNameList(names: readonly string[]): string[] {
  if (names.length <= 12) {
    return [...names];
  }
  return [...names.slice(0, 6), '…', ...names.slice(-3)];
}
