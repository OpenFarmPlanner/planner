/**
 * The "last updated" stamp of the terms and the privacy policy is shown on
 * the legal pages and in the re-consent prompt (`ConsentGate`). It names the
 * consented document version, so every language must name the same date.
 */

import { describe, expect, it } from 'vitest';

import homeDE from '../i18n/locales/de/home.json';
import homeEN from '../i18n/locales/en/home.json';
import homeES from '../i18n/locales/es/home.json';
import homeFR from '../i18n/locales/fr/home.json';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';

const GERMAN_MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const BUNDLES = { de: homeDE, en: homeEN, fr: homeFR, es: homeES } as const;

function germanStampDate(stamp: string): Date {
  const match = /(\d{1,2})\. (\p{L}+) (\d{4})/u.exec(stamp);
  if (!match) {
    throw new Error(`Unexpected German version stamp: ${stamp}`);
  }
  return new Date(Number(match[3]), GERMAN_MONTHS.indexOf(match[2]), Number(match[1]));
}

describe.each(['terms', 'privacy'] as const)('%s version stamp', (document) => {
  const date = germanStampDate(homeDE.legal[document].version);

  it.each(Object.keys(BUNDLES) as Array<keyof typeof BUNDLES>)('names the German date in %s', (language) => {
    const formatted = new Intl.DateTimeFormat(resolveLocaleFromLanguage(language), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
    expect(BUNDLES[language].legal[document].version).toContain(formatted);
  });
});
