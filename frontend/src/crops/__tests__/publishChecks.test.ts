import { describe, expect, it } from 'vitest';

import type { PublishPublicCropPreview } from '../../api/types';
import i18n from '../../i18n/config';
import {
  describePublishChecksFailure,
  extractPublishChecks,
  needsCropSpeciesSelection,
} from '../publishChecks';

const t = i18n.getFixedT('de', ['crops', 'common']) as unknown as (key: string, options?: Record<string, unknown>) => string;

const checks = (overrides: Partial<PublishPublicCropPreview>): PublishPublicCropPreview => ({
  crop_species: null,
  original_language_code: 'de',
  available_language_codes: ['de'],
  missing_required_fields: [],
  duplicates: [],
  can_publish: false,
  blocking_reasons: [],
  general_crop_notice: null,
  ...overrides,
});

const checksFailedError = (data: unknown) => ({
  isAxiosError: true,
  response: { status: 400, data },
});

describe('publishChecks', () => {
  it('asks for an official crop species when none is assigned', () => {
    expect(describePublishChecksFailure(checks({ blocking_reasons: ['missing_crop_species'] }), t))
      .toBe('Bitte wähle eine offizielle Kulturart aus.');
  });

  it('explains a species that is no longer available', () => {
    expect(describePublishChecksFailure(checks({ blocking_reasons: ['crop_species_unavailable'] }), t))
      .toMatch(/nicht mehr verfügbar\. Bitte wähle eine offizielle Kulturart aus\./);
  });

  it('names every reason, including the missing fields by label', () => {
    const message = describePublishChecksFailure(checks({
      blocking_reasons: ['missing_original_language', 'missing_required_fields'],
      missing_required_fields: [{ field: 'variety', label_key: 'library.publishWizard.fields.variety' }],
    }), t);

    expect(message).toContain('Bitte wähle die Originalsprache aus.');
    expect(message).toContain('Pflichtfelder: Sorte.');
  });

  it('falls back to the generic publish error for unknown or missing reasons', () => {
    expect(describePublishChecksFailure(checks({ blocking_reasons: [] }), t))
      .toBe('Die Kultur konnte nicht veröffentlicht werden.');
    expect(describePublishChecksFailure(
      checks({ blocking_reasons: ['something_new' as never] }),
      t,
    )).toBe('Die Kultur konnte nicht veröffentlicht werden.');
  });

  it('extracts the checks only from a publishing-checks rejection', () => {
    const payload = checks({ blocking_reasons: ['missing_crop_species'] });

    expect(extractPublishChecks(checksFailedError({
      code: 'public_crop_publishing_checks_failed',
      detail: 'Public crop publishing checks failed.',
      checks: payload,
    }))).toEqual(payload);
    expect(extractPublishChecks(checksFailedError({ code: 'crop_name_required', detail: 'x' }))).toBeNull();
    expect(extractPublishChecks(new Error('boom'))).toBeNull();
  });

  it('requires a species selection only for species-related reasons', () => {
    expect(needsCropSpeciesSelection(checks({ blocking_reasons: ['crop_species_unavailable'] }))).toBe(true);
    expect(needsCropSpeciesSelection(checks({ blocking_reasons: ['missing_crop_species', 'duplicates'] }))).toBe(true);
    expect(needsCropSpeciesSelection(checks({ blocking_reasons: ['duplicates'] }))).toBe(false);
  });
});
