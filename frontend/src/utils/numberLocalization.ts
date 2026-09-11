/**
 * Utilities for locale-aware number formatting and parsing.
 *
 * These helpers are intended for UI formatting and user input parsing only.
 * API payloads and persisted values must remain numeric.
 */

export function resolveLocaleFromLanguage(language: string | undefined): string {
  if (!language) {
    return "en-US";
  }
  if (language.toLowerCase().startsWith("de")) {
    return "de-DE";
  }
  if (language.toLowerCase().startsWith("en")) {
    return "en-US";
  }
  return language;
}

// Constructing an Intl.NumberFormat is one to two orders of magnitude more
// expensive than formatting with an existing one, and grid cells format
// numbers on every render — building one per call was a measurable share of
// the time spent scrolling large tables. The set of (locale, options) pairs an
// app run uses is small and fixed, so they are simply kept.
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function getNumberFormat(
  locale: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const cacheKey = options ? `${locale}|${JSON.stringify(options)}` : locale;
  const cached = numberFormatCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.NumberFormat(locale, options);
  numberFormatCache.set(cacheKey, formatter);
  return formatter;
}

export function formatLocalizedNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  return getNumberFormat(locale, options).format(value);
}

export function formatLocalizedNumberForInput(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return formatLocalizedNumber(value, locale, {
    useGrouping: false,
    maximumFractionDigits: 6,
    ...options,
  });
}

function getNumberSeparators(locale: string): {
  group: string;
  decimal: string;
} {
  const parts = getNumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((part) => part.type === "group")?.value ?? ",";
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  return { group, decimal };
}

export function parseLocalizedNumber(
  rawInput: string,
  locale: string,
): number | null {
  const input = rawInput.trim();
  if (input === "") {
    return null;
  }

  const { group, decimal } = getNumberSeparators(locale);

  const withoutSpaces = input.replace(/\s/g, "");
  const treatsDotAsDecimal =
    decimal !== "." &&
    withoutSpaces.includes(".") &&
    !withoutSpaces.includes(decimal);
  const withoutGrouping = group
    ? (treatsDotAsDecimal && group === "."
        ? withoutSpaces
        : withoutSpaces.split(group).join(""))
    : withoutSpaces;
  const normalizedDecimal = (treatsDotAsDecimal
    ? withoutGrouping
    : decimal
      ? withoutGrouping.split(decimal).join(".")
      : withoutGrouping)
    .replace(/,/g, ".")
    ;

  if (!/^[+-]?\d*(\.\d*)?$/.test(normalizedDecimal)) {
    return null;
  }

  const parsed = Number(normalizedDecimal);
  return Number.isNaN(parsed) ? null : parsed;
}
