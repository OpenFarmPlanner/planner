import type { CompanionImportItem } from '../api/types';
import { normalizeLanguageTag } from '../i18n/languages';

function splitOutside(text: string, separator: 'line' | 'name' | 'note'): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if ('(['.includes(char)) depth += 1;
    if (')]'.includes(char) && depth) depth -= 1;
    const split = separator === 'line' ? /[\r\n\u2028\u2029]/.test(char)
      : separator === 'name' ? !depth && /[,;]/.test(char)
        : char === '|' && text[index - 1] === ' ' && text[index + 1] === ' ';
    if (split) { parts.push(text.slice(start, index)); start = index + 1; }
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

function encode(value: string): string {
  return /[,;|"\\\r\n\u2028\u2029]/.test(value) || value.trim() !== value || /\s[-–]\s/.test(value)
    ? JSON.stringify(value) : value;
}

/** One group per line; quoted JSON strings escape reserved delimiters and line breaks. */
export function formatCompanionCell(items: readonly CompanionImportItem[], language = 'de'): string | null {
  if (!items.length) return null;
  const selectedLanguage = normalizeLanguageTag(language);
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const note = item.notes ? (selectedLanguage ? item.notes[selectedLanguage] ?? '' : '') : language === 'de' ? item.note : '';
    groups.set(note, [...(groups.get(note) ?? []), encode(item.name)]);
  }
  return [...groups].map(([note, names]) => `${names.join('; ')}${note ? ` | ${encode(note)}` : ''}`).join('\n');
}

export function parseCompanionCell(text: unknown): CompanionImportItem[] {
  if (typeof text !== 'string') return [];
  return splitOutside(text, 'line').flatMap((line) => {
    if (!/[\p{L}\p{N}]/u.test(line)) return [];
    const parts = splitOutside(line, 'note');
    const names = splitOutside(parts[0], 'name').map((name) => name.trim()).filter((name) => /[\p{L}\p{N}]/u.test(name));
    if (parts.length === 1 && names.some((name) => /\s[-–]\s/.test(name)) && !line.includes('"')) {
      return [{ name: names.join('; ').trim(), reason: 'other' as const, note: '', legacy: true }];
    }
    const note = parts.length > 1 ? decode(parts.slice(1).join(' | ')) : '';
    return splitOutside(parts[0], 'name').map(decode)
      .filter((name) => /[\p{L}\p{N}]/u.test(name))
      .map((name) => ({ name, reason: 'other' as const, note }));
  });
}
