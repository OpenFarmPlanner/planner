/**
 * Text normalization and term matching for page search.
 *
 * These rules are the binding specification in `docs/search.md`: a later
 * app-wide (backend) search has to normalize and match exactly like this.
 */

/** A half-open `[start, end)` slice of the original (un-normalized) text. */
export interface MatchRange {
  start: number;
  end: number;
}

const COMBINING_MARKS = /[̀-ͯ]/g;
const WHITESPACE = /\s+/;

/** Normalizes one code point: lower case, `ß` → `ss`, diacritics removed. */
const normalizeCodePoint = (codePoint: string): string =>
  codePoint
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '');

/**
 * Case-, diacritic- and `ß`/`ss`-insensitive form of `text`, so "Rübe",
 * "RUBE" and "rube" compare equal and "Straße" equals "strasse".
 */
export function normalizeSearchText(text: string): string {
  let normalized = '';
  for (const codePoint of text) {
    normalized += normalizeCodePoint(codePoint);
  }
  return normalized;
}

/**
 * Splits a raw query into normalized terms. Every term has to match
 * somewhere in a record (AND); duplicates are dropped.
 */
export function tokenizeSearchQuery(query: string): string[] {
  const terms = normalizeSearchText(query)
    .split(WHITESPACE)
    .filter((term) => term.length > 0);
  return Array.from(new Set(terms));
}

/** Whether a normalized term occurs inside `text` (normalized on the fly). */
export function textContainsTerm(text: string | null | undefined, term: string): boolean {
  return Boolean(text) && normalizeSearchText(text as string).includes(term);
}

/**
 * Where the normalized `terms` occur in `text`, as ranges of the original
 * string. Normalization can change the length (`ß` → `ss`, a decomposed
 * umlaut losing its combining mark), so every normalized character keeps a
 * pointer to the original code point it came from. Overlapping and adjacent
 * ranges are merged, which keeps a `<mark>` from being split mid-match.
 */
export function findMatchRanges(text: string, terms: readonly string[]): MatchRange[] {
  if (!text || terms.length === 0) {
    return [];
  }

  let normalized = '';
  const sourceStart: number[] = [];
  const sourceEnd: number[] = [];
  let offset = 0;
  for (const codePoint of text) {
    const normalizedPart = normalizeCodePoint(codePoint);
    const codePointEnd = offset + codePoint.length;
    if (normalizedPart.length === 0 && sourceEnd.length > 0) {
      // A standalone combining mark belongs to the preceding character.
      sourceEnd[sourceEnd.length - 1] = codePointEnd;
    }
    for (let index = 0; index < normalizedPart.length; index += 1) {
      sourceStart.push(offset);
      sourceEnd.push(codePointEnd);
    }
    normalized += normalizedPart;
    offset = codePointEnd;
  }

  const ranges: MatchRange[] = [];
  for (const term of terms) {
    if (!term) {
      continue;
    }
    let matchIndex = normalized.indexOf(term);
    while (matchIndex !== -1) {
      ranges.push({
        start: sourceStart[matchIndex],
        end: sourceEnd[matchIndex + term.length - 1],
      });
      matchIndex = normalized.indexOf(term, matchIndex + 1);
    }
  }

  ranges.sort((left, right) => left.start - right.start);
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * A window of `text` around the first hit, so a hit deep inside a long note
 * is still on screen. Returns the text unchanged when it is short enough or
 * has no hit; cut ends are marked with an ellipsis.
 */
export function buildMatchExcerpt(text: string, terms: readonly string[], maxLength = 120): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  const [firstHit] = findMatchRanges(singleLine, terms);
  const hitStart = firstHit?.start ?? 0;
  const start = Math.max(0, Math.min(hitStart - Math.floor(maxLength / 3), singleLine.length - maxLength));
  const end = Math.min(singleLine.length, start + maxLength);
  return `${start > 0 ? '…' : ''}${singleLine.slice(start, end).trim()}${end < singleLine.length ? '…' : ''}`;
}
