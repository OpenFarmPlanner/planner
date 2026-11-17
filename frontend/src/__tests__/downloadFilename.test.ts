import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { loadLanguages } from '../i18n/config';
import { buildAllCropsFilename, buildSingleCropFilename } from '../crops/exportUtils';
import { buildSpreadsheetFilename } from '../crops/spreadsheetExport';
import { buildDownloadFilename } from '../utils/downloadFilename';
import type { Crop } from '../api/types';

const DATE = new Date('2026-06-29T12:00:00Z');
const today = new Date().toISOString().slice(0, 10);
const crop = { name: 'Tomate', variety: '', supplier: { id: 1, name: 'Bingenheimer' } } as Crop;

const EXPECTED = {
  de: ['kulturen_vorlage.ods', 'kulturen_export_2026-06-29.json', 'kultur_tomate_unbekannt_2026-06-29.json', 'openfarmplanner-datenexport.json'],
  en: ['crops_template.ods', 'crops_export_2026-06-29.json', 'crop_tomate_unknown_2026-06-29.json', 'openfarmplanner-data-export.json'],
  fr: ['modele_cultures.ods', 'export_cultures_2026-06-29.json', 'culture_tomate_inconnu_2026-06-29.json', 'openfarmplanner-export-donnees.json'],
  es: ['plantilla_cultivos.ods', 'exportacion_cultivos_2026-06-29.json', 'cultivo_tomate_desconocido_2026-06-29.json', 'openfarmplanner-exportacion-datos.json'],
  it: ['modello_colture.ods', 'esportazione_colture_2026-06-29.json', 'coltura_tomate_sconosciuto_2026-06-29.json', 'openfarmplanner-esportazione-dati.json'],
  pt: ['modelo_culturas.ods', 'exportacao_culturas_2026-06-29.json', 'cultura_tomate_desconhecido_2026-06-29.json', 'openfarmplanner-exportacao-dados.json'],
  nl: ['gewassen_sjabloon.ods', 'gewassen_export_2026-06-29.json', 'gewas_tomate_onbekend_2026-06-29.json', 'openfarmplanner-gegevensexport.json'],
} as const;

describe('generated download filenames', () => {
  const original = i18n.language;
  afterEach(async () => { await i18n.changeLanguage(original); });

  it.each(Object.entries(EXPECTED))('are localized in %s', async (language, [template, all, single, account]) => {
    await loadLanguages([language]);
    const t = i18n.getFixedT(language) as unknown as (key: string) => string;
    expect(buildDownloadFilename(t, 'cropTemplate', 'ods')).toBe(template);
    expect(buildAllCropsFilename(t, DATE)).toBe(all);
    expect(buildSingleCropFilename(crop, t, DATE)).toBe(single);
    expect(buildDownloadFilename(t, 'accountDataExport', 'json')).toBe(account);
    expect(buildSpreadsheetFilename('xlsx', 'all', t)).toMatch(new RegExp(`_${today}\\.xlsx$`));
  });

  it('follows a language switch on the next download', async () => {
    await loadLanguages(['en']);
    await i18n.changeLanguage('de');
    expect(buildSpreadsheetFilename('csv', 'all', i18n.t.bind(i18n))).toBe(`kulturen_export_${today}.csv`);
    await i18n.changeLanguage('en');
    expect(buildSpreadsheetFilename('csv', 'all', i18n.t.bind(i18n))).toBe(`crops_export_${today}.csv`);
  });

  it('names every download in plain ASCII so browsers keep the suggested name', async () => {
    await loadLanguages(['fr', 'es', 'pt']);
    for (const language of ['fr', 'es', 'pt']) {
      const t = i18n.getFixedT(language) as unknown as (key: string) => string;
      for (const key of ['cropTemplate', 'cropExport', 'crop', 'unknown', 'accountDataExport'] as const) {
        expect(buildDownloadFilename(t, key, 'ods')).toMatch(/^[\x21-\x7e]+$/);
      }
    }
  });

  it('keeps user-provided parts as slugs and never drops the extension', () => {
    const t = i18n.getFixedT('de') as unknown as (key: string) => string;
    const named = { ...crop, supplier: { id: 1, name: 'Müller & Söhne' }, variety: 'Grüner Zwerg' } as Crop;
    expect(buildSpreadsheetFilename('ods', 'single', t, named)).toBe(`kultur_muller_sohne_gruner_zwerg_${today}.ods`);
  });
});
