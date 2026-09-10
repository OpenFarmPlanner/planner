import { describe, expect, it } from 'vitest';
import {
  formatHistoryChangeValue,
  getBatchSummary,
  getHistoryChangeFieldLabel,
  getHistoryActorLabel,
  getHistoryEntryMeta,
  getHistoryEntryTarget,
  getHistoryEntryTitle,
  isBatchGroupEntry,
  isCurrentHistoryEntry,
} from '../pages/cropsHistoryUtils';
import i18n from '../i18n';
import type { CropHistoryEntry } from '../api/types';

const t = i18n.getFixedT('de', 'crops');

function buildEntry(partial: Partial<CropHistoryEntry>): CropHistoryEntry {
  return {
    history_id: 1,
    history_date: '2026-03-23T14:48:00.000Z',
    history_type: 'snapshot',
    history_user: null,
    summary: '',
    ...partial,
  };
}

describe('cropsHistoryUtils', () => {
  it('builds a localized title with object label and display name', () => {
    const entry = buildEntry({
      object_type: 'crop',
      object_display_name: 'Bijella',
      action: 'updated',
    });

    expect(getHistoryEntryTitle(entry, t)).toBe('Kultur „Bijella“ bearbeitet');
  });

  it('falls back to generic localized labels for unknown object type and missing name', () => {
    const entry = buildEntry({
      object_type: 'unknown_type',
      object_display_name: null,
      action: 'created',
    });

    expect(getHistoryEntryTitle(entry, t)).toBe('Eintrag erstellt');
  });

  it('prefers actor_label over history_user and falls back to unknown user', () => {
    const withActor = buildEntry({ actor_label: 'Martin Stipsitz', history_user: 'ignored@example.com' });
    const withHistoryUser = buildEntry({ actor_label: '', history_user: 'user@example.com' });
    const withoutActor = buildEntry({ actor_label: '', history_user: null });

    expect(getHistoryActorLabel(withActor, t)).toBe('Martin Stipsitz');
    expect(getHistoryActorLabel(withHistoryUser, t)).toBe('user@example.com');
    expect(getHistoryActorLabel(withoutActor, t)).toBe('Unbekannter Nutzer');
    expect(getHistoryActorLabel(withoutActor, t, 'Fallback User')).toBe('Fallback User');
  });

  it('builds metadata line with explicit version timestamp wording', () => {
    const entry = buildEntry({
      actor_label: 'Martin Stipsitz',
      history_date: '2026-03-23T14:48:00.000Z',
    });

    const meta = getHistoryEntryMeta(entry, t);
    expect(meta).toContain('Version vom');
  });

  it('builds crop links from crop_id and summary fallback', () => {
    const withCropId = buildEntry({
      object_type: 'crop',
      crop_id: 42,
      summary: 'Crop #42 updated',
    });
    const withSummaryId = buildEntry({
      object_type: 'crop',
      summary: 'Crop #7 updated',
    });

    expect(getHistoryEntryTarget(withCropId)).toBe('/app/crops?cropId=42');
    expect(getHistoryEntryTarget(withSummaryId)).toBe('/app/crops?cropId=7');
  });

  it('builds planting plan link and returns null for unsupported types', () => {
    const plantingPlanEntry = buildEntry({
      object_type: 'planting_plan',
      summary: 'PlantingPlan #3 created',
    });
    const unsupportedEntry = buildEntry({
      object_type: 'field',
      summary: 'Field #2 updated',
    });

    expect(getHistoryEntryTarget(plantingPlanEntry)).toBe('/app/planting-plans');
    expect(getHistoryEntryTarget(unsupportedEntry)).toBeNull();
  });

  it('treats any batch entry as a group and plain revisions as not', () => {
    const child = buildEntry({ object_type: 'planting_plan', action: 'deleted' });
    expect(isBatchGroupEntry(buildEntry({ is_batch: true, children: [child] }))).toBe(true);
    expect(isBatchGroupEntry(buildEntry({ is_batch: true, children: [child, child] }))).toBe(true);
    expect(isBatchGroupEntry(buildEntry({ children: [child, child] }))).toBe(false);
  });

  it('summarizes a season-delete batch with per-action planting-plan counts', () => {
    const entry = buildEntry({
      is_batch: true,
      batch_operation_type: 'season_delete',
      batch_context: { season_label: '25/26' },
      children: [
        buildEntry({ object_type: 'season', action: 'deleted' }),
        buildEntry({ object_type: 'planting_plan', action: 'deleted' }),
        buildEntry({ object_type: 'planting_plan', action: 'deleted' }),
      ],
    });

    expect(getBatchSummary(entry, t)).toBe('Saison 25/26 gelöscht: 2 Anbaupläne gelöscht');
  });

  it('summarizes a season copy-data batch', () => {
    const entry = buildEntry({
      is_batch: true,
      batch_operation_type: 'season_copy_data',
      batch_context: { source_season_label: '24/25', target_season_label: '25/26' },
      children: [
        buildEntry({ object_type: 'planting_plan', action: 'created' }),
      ],
    });

    expect(getBatchSummary(entry, t)).toBe('Daten aus Saison 24/25 übernommen: 1 Anbauplan neu angelegt');
  });

  it('formats crop history change labels and values', () => {
    const change = {
      field: 'expected_yield',
      old_value: 2.5,
      new_value: 3,
    };

    expect(getHistoryChangeFieldLabel(change, t)).toBe('Erwarteter Ertrag');
    expect(formatHistoryChangeValue(change.old_value, change.field, t)).toBe('2,5 kg');
    expect(formatHistoryChangeValue(change.new_value, change.field, t)).toBe('3 kg');
  });
});

describe('isCurrentHistoryEntry', () => {
  it('trusts the backend flag wherever the entry sits in the list', () => {
    expect(isCurrentHistoryEntry(buildEntry({ is_current_version: true }), 5)).toBe(true);
    expect(isCurrentHistoryEntry(buildEntry({ is_current_version: false }), 0)).toBe(false);
  });

  it('falls back to "the newest row" when the backend did not say', () => {
    expect(isCurrentHistoryEntry(buildEntry({}), 0)).toBe(true);
    expect(isCurrentHistoryEntry(buildEntry({}), 1)).toBe(false);
  });
});

describe('formatHistoryChangeValue', () => {
  const value = (raw: unknown, field: string): string => formatHistoryChangeValue(raw, field, t);

  it('renders every kind of empty as the same placeholder', () => {
    expect(value(null, 'name')).toBe('Nicht gesetzt');
    expect(value(undefined, 'name')).toBe('Nicht gesetzt');
    expect(value('', 'name')).toBe('Nicht gesetzt');
  });

  it('keeps zero and false, which are values rather than emptiness', () => {
    expect(value(0, 'expected_yield')).toBe('0 kg');
    expect(value(false, 'seeding_requirement')).toBe('Nein');
    expect(value(true, 'seeding_requirement')).toBe('Ja');
  });

  it('converts the metre-based fields to centimetres for display', () => {
    // Lengths are stored in SI metres; the form shows centimetres.
    expect(value(0.25, 'distance_within_row_m')).toBe('25 cm');
    expect(value(0.5, 'row_spacing_m')).toBe('50 cm');
    expect(value(0.015, 'sowing_depth_m')).toBe('1,5 cm');
  });

  it('appends the unit each numeric field is measured in', () => {
    expect(value(3.5, 'thousand_kernel_weight_g')).toBe('3,5 g');
    expect(value(10, 'sowing_calculation_safety_percent')).toBe('10 %');
    expect(value(10, 'sowing_calculation_safety_percent_direct')).toBe('10 %');
  });

  it('leaves a plain number unitless and formats it in German notation', () => {
    expect(value(45, 'growth_duration_days')).toBe('45');
    expect(value(1234.5, 'growth_duration_days')).toBe('1.234,5');
    expect(value(1.23456, 'growth_duration_days')).toBe('1,235');
  });

  it('translates the enum fields instead of showing the stored token', () => {
    expect(value('direct_sowing', 'cultivation_type')).toBe('Direktsaat');
    expect(value('pre_cultivation', 'cultivation_type')).toBe('Pflanzung');
    expect(value('per_sqm', 'harvest_method')).toBe('Pro m²');
    expect(value('per_plant', 'harvest_method')).toBe('Pro Pflanze');
    expect(value('high', 'nutrient_demand')).toBe('Starkzehrer');
  });

  it('passes an unknown enum token through rather than blanking the row', () => {
    expect(value('etwas_neues', 'cultivation_type')).toBe('etwas_neues');
    expect(value('etwas_neues', 'nutrient_demand')).toBe('etwas_neues');
  });

  it('renders a cultivation type list as a joined, translated list', () => {
    expect(value(['direct_sowing', 'pre_cultivation'], 'cultivation_types'))
      .toBe('Direktsaat, Pflanzung');
  });

  it('renders seed rate units with their symbol, on every unit field', () => {
    expect(value('g_per_m2', 'seed_rate_unit')).toBe('g / m²');
    expect(value('seeds_per_lfm', 'seed_rate_direct_unit')).toBe('Korn / lfm');
    expect(value('seeds_per_plant', 'seed_rate_pre_cultivation_unit')).toBe('Korn / Pflanze');
    expect(value('unbekannt', 'seed_rate_unit')).toBe('unbekannt');
  });

  it('spells out the per-method seed rates instead of dumping the object', () => {
    expect(value(
      { direct_sowing: { value: 2.5, unit: 'g_per_m2' } },
      'seed_rate_by_cultivation',
    )).toBe('Direktsaat: 2,5 g / m²');
  });

  it('skips seed rate methods that carry no numeric value', () => {
    expect(value(
      { direct_sowing: { value: 2, unit: 'g_per_m2' }, pre_cultivation: { unit: 'g_per_m2' } },
      'seed_rate_by_cultivation',
    )).toBe('Direktsaat: 2 g / m²');
  });

  it('falls back to the placeholder when no seed rate method is usable', () => {
    expect(value({}, 'seed_rate_by_cultivation')).toBe('Nicht gesetzt');
    expect(value([], 'seed_rate_by_cultivation')).toBe('Nicht gesetzt');
    expect(value('unsinn', 'seed_rate_by_cultivation')).toBe('Nicht gesetzt');
  });

  it('renders the creation pseudo-field as its own message', () => {
    expect(value('irgendwas', 'created')).toBe('Erstellt');
  });

  it('summarises an object it has no formatter for, rather than showing [object Object]', () => {
    expect(value({ a: 1 }, 'notes')).toBe('Details geändert');
  });

  it('formats each item of a plain array with the same field rules', () => {
    expect(value([1.5, 2.5], 'expected_yield')).toBe('1,5 kg, 2,5 kg');
  });
});

describe('getHistoryChangeFieldLabel', () => {
  it('falls back rather than showing the raw column name', () => {
    expect(getHistoryChangeFieldLabel({ field: 'irgendwas' }, t)).toBe('Feld');
  });
});

describe('getHistoryActorLabel', () => {
  it('skips a blank value at every level rather than rendering whitespace', () => {
    const blank = buildEntry({ actor_label: '  ', history_user: '  ' });

    expect(getHistoryActorLabel(blank, t, '  ')).toBe('Unbekannter Nutzer');
  });
});

describe('getBatchSummary', () => {
  const plan = (action: string) => buildEntry({ object_type: 'planting_plan', action });

  it('falls back for an operation type it does not know', () => {
    expect(getBatchSummary(buildEntry({ is_batch: true, batch_operation_type: 'etwas_neues' }), t))
      .toBe('Mehrere Änderungen');
  });

  it('shows the base text alone when no planting plan was touched', () => {
    expect(getBatchSummary(buildEntry({
      is_batch: true,
      batch_operation_type: 'season_create',
      batch_context: { season_label: '25/26' },
    }), t)).toBe('Saison 25/26 erstellt');
  });

  it('lists the counts in a fixed order, not in the order the children arrived', () => {
    const summary = getBatchSummary(buildEntry({
      is_batch: true,
      batch_operation_type: 'season_copy_data',
      batch_context: { source_season_label: '24/25' },
      children: [plan('updated'), plan('created'), plan('deleted')],
    }), t);

    expect(summary).toBe(
      'Daten aus Saison 24/25 übernommen: 1 Anbauplan gelöscht, 1 Anbauplan neu angelegt, '
      + '1 Anbauplan bearbeitet',
    );
  });

  it('treats a child with no action as an update', () => {
    expect(getBatchSummary(buildEntry({
      is_batch: true,
      batch_operation_type: 'season_create',
      batch_context: { season_label: '25/26' },
      children: [buildEntry({ object_type: 'planting_plan' })],
    }), t)).toBe('Saison 25/26 erstellt: 1 Anbauplan bearbeitet');
  });

  it('describes a revert by naming the operation it undid', () => {
    expect(getBatchSummary(buildEntry({
      is_batch: true,
      batch_operation_type: 'batch_reverted',
      batch_context: { reverted_operation_type: 'season_delete', season_label: '25/26' },
    }), t)).toBe('Wiederhergestellt: Saison 25/26 gelöscht');
  });
});

describe('getHistoryEntryTarget', () => {
  it('prefers the explicit crop id over one parsed out of the summary', () => {
    expect(getHistoryEntryTarget(buildEntry({
      object_type: 'crop', crop_id: 7, summary: 'Crop #42 updated',
    }))).toBe('/app/crops?cropId=7');
  });

  it('falls back to the crop list when no id can be found anywhere', () => {
    expect(getHistoryEntryTarget(buildEntry({ object_type: 'crop', summary: 'ohne Nummer' })))
      .toBe('/app/crops');
  });
});

describe('getHistoryEntryMeta', () => {
  it('renders the timestamp only — the actor it resolves is not part of the message', () => {
    // `history.meta` interpolates `{{timestamp}}` in both de and en, so the
    // `actor` the function computes and passes is discarded. Pinned as the
    // behaviour that ships; whether the actor was meant to appear here is a
    // product decision, not something to change under a test.
    const withActor = getHistoryEntryMeta(buildEntry({ actor_label: 'Anna' }), t);
    const withoutActor = getHistoryEntryMeta(
      buildEntry({ actor_label: '', history_user: null }), t,
    );

    expect(withActor).toContain('Version vom');
    expect(withActor).not.toContain('Anna');
    expect(withoutActor).toBe(withActor);
  });

  it('formats the timestamp in German regardless of the active language', () => {
    // `toLocaleString('de-DE')` is hardcoded, so an English UI still shows
    // German date formatting here.
    const meta = getHistoryEntryMeta(
      buildEntry({ history_date: '2026-03-23T14:48:00.000Z' }), t,
    );

    expect(meta).toContain('23.3.2026');
  });
});
