import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { I18N_NAMESPACES } from '../i18n/config';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';

const LOCALES_DIR = path.resolve(__dirname, '../i18n/locales');

describe('lazy language bundles', () => {
  it.each(SUPPORTED_LANGUAGES.map((language) => language.code))(
    'bundles every namespace file of %s',
    async (code) => {
      const files = fs
        .readdirSync(path.join(LOCALES_DIR, code))
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace(/\.json$/, ''))
        .sort();
      const bundle = (await import(`../i18n/locales/${code}/index.ts`)).default;

      expect(Object.keys(bundle).sort()).toEqual(files);
      expect([...I18N_NAMESPACES].sort()).toEqual(files);
    },
  );
});
