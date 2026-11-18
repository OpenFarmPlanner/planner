import type { CompanionImportItem } from '../api/types';
import { normalizeLanguageTag } from '../i18n/languages';
import { LIST_CELL_SEPARATOR } from './spreadsheetColumns';

function isNoteSeparator(text: string, index: number): boolean {
  return text[index] === '|' && text[index - 1] === ' ' && text[index + 1] === ' ';
}

/**
 * Splits outside quoted JSON strings. Brackets protect name separators in names
 * such as `Kräuter (Dill; Basilikum)`; a note after ` | ` runs to the next `;`.
 */
function splitOutside(text: string, separator: 'line' | 'entry' | 'name' | 'note'): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let depth = 0;
  let inNote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if ('(['.includes(char)) depth += 1;
    if (')]'.includes(char) && depth) depth -= 1;
    if (isNoteSeparator(text, index)) inNote = true;
    const split = separator === 'line' ? /[\r\n\u2028\u2029]/.test(char)
      : separator === 'entry' ? char === ';' && (inNote || !depth)
        : separator === 'name' ? !depth && /[,;]/.test(char)
          : isNoteSeparator(text, index);
    if (split) {
      parts.push(text.slice(start, index));
      start = index + 1;
      if (separator === 'entry') { inNote = false; depth = 0; }
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function decode(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(trimmed);
      if (typeof decoded === 'string') return decoded;
    } catch { /* Preserve malformed quoted input as text for the preview. */ }
  }
  return trimmed;
}

/** An open bracket would keep the following `;` from ending the entry. */
function hasUnbalancedBrackets(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if ('(['.includes(char)) depth += 1;
    if (')]'.includes(char) && depth) depth -= 1;
  }
  return depth > 0;
}

function encode(value: string): string {
  return /[,;|"\\\r\n\u2028\u2029]/.test(value) || value.trim() !== value || /\s[-–]\s/.test(value)
    || hasUnbalancedBrackets(value)
    ? JSON.stringify(value) : value;
}

/** Notes may contain commas and dashes; only entry and note delimiters need quoting. */
function encodeNote(value: string): string {
  return /[;|"\\\r\n\u2028\u2029]/.test(value) || value.trim() !== value ? JSON.stringify(value) : value;
}

const hasText = (value: string) => /[\p{L}\p{N}]/u.test(value);

/** Language maps are authoritative; older records fall back to their scalar note. */
export function getCompanionNote(item: Pick<CompanionImportItem, 'note' | 'notes'>, language: string): string {
  const selectedLanguage = normalizeLanguageTag(language);
  return item.notes ? (selectedLanguage ? item.notes[selectedLanguage] ?? '' : '') : item.note;
}

/**
 * Entries `Name` or `Name | Note`, separated by `; ` like every multi-value
 * culture cell; quoted JSON strings escape reserved delimiters and line breaks.
 */
export function formatCompanionCell(items: readonly CompanionImportItem[], language = 'de'): string | null {
  if (!items.length) return null;
  return items.map((item) => {
    const note = getCompanionNote(item, language);
    return `${encode(item.name)}${note ? ` | ${encodeNote(note)}` : ''}`;
  }).join(LIST_CELL_SEPARATOR);
}

/**
 * Entries are separated by `;`; older files may also use line breaks, or `,`
 * between names. A note after ` | ` belongs only to the name directly before
 * it: `Tomate | A; Gurke | B; Basilikum`.
 */
export function parseCompanionCell(text: unknown): CompanionImportItem[] {
  if (typeof text !== 'string') return [];
  return splitOutside(text, 'line').flatMap((line) => {
    if (!hasText(line)) return [];
    const names = splitOutside(line, 'name').map((name) => name.trim()).filter(hasText);
    if (splitOutside(line, 'note').length === 1 && !line.includes('"') && names.some((name) => /\s[-–]\s/.test(name))) {
      return [{ name: line.trim().replace(/[\s,;]+$/, ''), reason: 'other' as const, note: '', legacy: true }];
    }
    return splitOutside(line, 'entry').flatMap(parseEntry);
  });
}

function parseEntry(entry: string): CompanionImportItem[] {
  const parts = splitOutside(entry, 'note');
  const names = splitOutside(parts[0], 'name').map(decode).filter(hasText);
  const note = parts.length > 1 ? decode(parts.slice(1).join(' | ')) : '';
  return names.map((name, index) => ({ name, reason: 'other' as const, note: index === names.length - 1 ? note : '' }));
}
