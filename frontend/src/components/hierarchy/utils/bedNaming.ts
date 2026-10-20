/**
 * Name generation shared by "Beet hinzufügen", "Beet duplizieren", the
 * "Mehrere Beete anlegen" dialog and "Parzelle duplizieren". Bed names are
 * unique per field and field names per location (backend constraints).
 */

const LAST_NUMBER_PATTERN = /^(.*?)(\d+)(\D*)$/;

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

/**
 * `count` names starting at `firstName`, each the previous one counted up
 * with `incrementName`: "E 2 1" → "E 2 1", "E 2 2", …; "Nordbeet" →
 * "Nordbeet", "Nordbeet 2", …. Names already taken are not skipped, so the
 * series stays predictable; conflicts are reported separately.
 */
export function buildBedNameSeries(firstName: string, count: number): string[] {
  const trimmed = firstName.trim();
  if (trimmed === '' || !(count > 0)) {
    return [];
  }
  const names = [trimmed];
  while (names.length < count) {
    names.push(incrementName(names[names.length - 1]));
  }
  return names;
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
