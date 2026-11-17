/**
 * Names of files the app generates for download. The application-owned words
 * come from `common:downloadFilenames.*` in the active UI language at the
 * moment of the download; extensions, dates and user-provided parts stay as
 * they are (docs/i18n.md, #1185).
 */
export type DownloadFilenameKey =
  | 'cropTemplate'
  | 'cropExport'
  | 'crop'
  | 'unknown'
  | 'accountDataExport';

type FilenameT = (key: string) => string;

// Characters no common file system or browser accepts in a file name;
// control characters are dropped separately.
const UNSAFE_CHARACTERS = /[\\/:*?"<>|]+/g;

const withoutControlCharacters = (value: string): string => (
  Array.from(value).filter((character) => character.charCodeAt(0) >= 0x20).join('')
);

/**
 * The translated word(s) for `key`, made safe for a file name. Accents are
 * removed: Chromium replaces a blob download name with non-ASCII letters by
 * "download" (#1185).
 */
export function downloadFilenameWord(t: FilenameT, key: DownloadFilenameKey): string {
  return withoutControlCharacters(t(`common:downloadFilenames.${key}`))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(UNSAFE_CHARACTERS, '_')
    .replace(/\s+/g, '_');
}

/** `<translated stem>[_<part>…].<extension>`; empty parts are dropped. */
export function buildDownloadFilename(
  t: FilenameT,
  key: DownloadFilenameKey,
  extension: string,
  parts: readonly string[] = [],
): string {
  const stem = [downloadFilenameWord(t, key), ...parts.filter(Boolean)].join('_');
  return `${stem}.${extension}`;
}
