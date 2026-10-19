/**
 * The legal texts (imprint, privacy policy, terms) exist in German, English,
 * French and Spanish and must say the same in every language. Wording is
 * reviewed by people; this test guards what can be checked mechanically:
 * every paragraph cites the same articles and sections (in one uniform
 * notation, e.g. "Art. 6(1)(f)", "§ 165(3)"), and names the same numbers,
 * deadlines, URLs and email addresses in all four languages.
 */

import { describe, expect, it } from 'vitest';

import homeDE from '../i18n/locales/de/home.json';
import homeEN from '../i18n/locales/en/home.json';
import homeES from '../i18n/locales/es/home.json';
import homeFR from '../i18n/locales/fr/home.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      flat.set(path, value);
    } else {
      for (const [nested, text] of flatten(value, path)) {
        flat.set(nested, text);
      }
    }
  }
  return flat;
}

const LEGAL = {
  de: flatten(homeDE.legal as Tree),
  en: flatten(homeEN.legal as Tree),
  fr: flatten(homeFR.legal as Tree),
  es: flatten(homeES.legal as Tree),
};

const citations = (text: string): string[] =>
  [...text.matchAll(/(?:Art\.|art\.|§)\s?\d+(?:\(\d+\))*(?:\([a-z]\))?/g)].map((m) => m[0].toLowerCase()).sort();
const numbers = (text: string): string[] => [...text.matchAll(/\d+/g)].map((m) => m[0]).sort();
const links = (text: string): string[] =>
  [...text.matchAll(/https?:\/\/[^\s)]+|[\w.+-]+@[\w.-]+\.\w+/g)].map((m) => m[0]).sort();

describe('legal texts say the same in every language', () => {
  it.each(['fr', 'es', 'de'] as const)('%s has every English paragraph and no extra one', (language) => {
    expect([...LEGAL[language].keys()].sort()).toEqual([...LEGAL.en.keys()].sort());
  });

  it.each(['de', 'fr', 'es'] as const)('%s cites the same articles, numbers and links as English', (language) => {
    for (const [key, english] of LEGAL.en) {
      const text = LEGAL[language].get(key) ?? '';
      expect(citations(text), `citations in ${language}:${key}`).toEqual(citations(english));
      expect(numbers(text), `numbers in ${language}:${key}`).toEqual(numbers(english));
      expect(links(text), `links in ${language}:${key}`).toEqual(links(english));
    }
  });

  it('uses the uniform citation notation, never the German "Abs."/"lit." form', () => {
    for (const [language, texts] of Object.entries(LEGAL)) {
      for (const [key, text] of texts) {
        expect(text, `${language}:${key}`).not.toMatch(/\bAbs\.|\blit\.\s?[a-z]\b|Art\.\s?\d+\s(?:Nr|No)\./);
      }
    }
  });
});
