import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Crop, PublicCrop } from '../api/types';
import i18n from '../i18n/config';
import { SpecificPropertiesSection } from '../crops/sections/SpecificPropertiesSection';
import { SpecificPropertiesDetails } from '../crops/SpecificPropertiesDetails';
import { hasEffectiveCropFormChanges } from '../crops/cropFormChangeDetection';
import { validateCrop } from '../crops/validation';
import { buildPublicCropUpdatePayload, publicCropToCropFormData } from '../crops/publicCropFormAdapter';
import { buildSheetData } from '../crops/spreadsheetExport';
import { buildSpreadsheetFile } from '../crops/spreadsheetFile';
import { buildSpecificPropertyPreviewErrors, mapImportErrors } from '../pages/cropsPageUtils';
import { formatImportFailure } from '../pages/cropsImportUtils';
import { parseSpreadsheetFile } from '../crops/spreadsheetImport';

const t = (key: string) => key;
const profile = 'solanum_tuberosum';

afterEach(async () => { await i18n.changeLanguage('de'); });

describe('crop-specific properties', () => {
  it('offers optional typed fields on species selection without needing a variety', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SpecificPropertiesSection t={t} onChange={onChange} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    rerender(<SpecificPropertiesSection profile={profile} t={t} onChange={onChange} />);
    const cooking = screen.getByRole('combobox', { name: 'specificProperties.fields.cooking_type' });
    expect(screen.getByRole('combobox', { name: 'specificProperties.fields.maturity_group' })).toBeVisible();
    fireEvent.mouseDown(cooking);
    fireEvent.click(screen.getByRole('option', { name: 'specificProperties.values.cooking_type.waxy' }));
    expect(onChange).toHaveBeenCalledWith({ cooking_type: 'waxy' });
  });

  it('preserves incompatible values on species changes until the explicit clear action', () => {
    const onChange = vi.fn();
    const values = { cooking_type: 'waxy', maturity_group: 'early' };
    const { rerender } = render(<SpecificPropertiesSection profile={profile} values={values} t={t} onChange={onChange} />);
    rerender(<SpecificPropertiesSection profile="" values={values} t={t} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('specificProperties.incompatible');
    fireEvent.click(screen.getByRole('button', { name: 'specificProperties.clearIncompatible' }));
    expect(onChange).toHaveBeenCalledWith({});
    expect(values).toEqual({ cooking_type: 'waxy', maturity_group: 'early' });
  });

  it('shows only filled own values in details and uses localized option labels', () => {
    const { rerender } = render(<SpecificPropertiesDetails profile={profile} t={t} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    rerender(<SpecificPropertiesDetails profile={profile} variety="Early" values={{ cooking_type: 'waxy' }} t={t} />);
    expect(screen.getByText('specificProperties.varietyValues')).toBeInTheDocument();
    expect(screen.getByText('specificProperties.values.cooking_type.waxy')).toBeInTheDocument();
    expect(screen.queryByText('specificProperties.fields.maturity_group')).not.toBeInTheDocument();
    expect(screen.queryByText('waxy', { exact: true })).not.toBeInTheDocument();
  });

  it('tracks semantic edits, rejects unsupported scopes, and keeps duration independent', () => {
    const values = { cooking_type: 'waxy', maturity_group: 'early' };
    expect(hasEffectiveCropFormChanges({ specific_properties: values }, {
      specific_properties: { maturity_group: 'early', cooking_type: 'waxy' },
    })).toBe(false);
    expect(hasEffectiveCropFormChanges({}, { specific_properties: values })).toBe(true);
    const crop = { name: 'Potato', specific_property_profile: profile, specific_properties: values } as Crop;
    expect(validateCrop(crop, t).errors['specific_properties.cooking_type']).toBeUndefined();
    expect(validateCrop({ ...crop, specific_property_profile: '' }, t).errors['specific_properties.cooking_type']).toBeDefined();
    const draft = publicCropToCropFormData({ id: 1, ...crop, growth_duration_days: 120 } as PublicCrop);
    const payload = buildPublicCropUpdatePayload(draft, 1);
    expect(payload.specific_properties).toEqual(values);
    expect(payload.growth_duration_days).toBe(120);
    expect(payload).not.toHaveProperty('specific_property_profile');
  });

  it('localizes row preview and apply errors without exposing backend payloads', () => {
    const results = [{ index: 0, import_data: {}, error: 'Property cooking_type is unsupported', error_code: 'specific_properties_invalid' }];
    const translate = (key: string, options?: Record<string, unknown>) => `${key}:${options?.row ?? ''}`;
    expect(buildSpecificPropertyPreviewErrors(results, () => 7, translate)).toEqual(['specificProperties.importRowInvalid:7']);
    const failures = mapImportErrors(results, [{ name: 'Potato' }]);
    expect(formatImportFailure(failures[0], i18n.getFixedT('de', 'crops'))).toBe(i18n.getFixedT('de', 'crops')('specificProperties.importInvalid'));
  });

  it('exports only relevant columns and leaves inapplicable mixed rows empty', () => {
    const ordinary = { id: 1, name: 'Carrot' } as Crop;
    const potato = { id: 2, name: 'Potato', specific_property_profile: profile, specific_properties: { cooking_type: 'waxy' } } as Crop;
    const absent = buildSheetData([ordinary], t);
    expect(absent[0]).not.toContain('specificProperties.fields.cooking_type');
    const mixed = buildSheetData([ordinary, potato], t);
    const index = mixed[0].indexOf('specificProperties.fields.cooking_type');
    expect(index).toBeGreaterThan(-1);
    expect(mixed[1][index]).toBeNull();
    expect(mixed[2][index]).toBe('specificProperties.values.cooking_type.waxy');
  });

  for (const language of ['de', 'en', 'fr', 'es']) {
    it.each(['csv', 'xlsx', 'ods'] as const)(`round-trips every enum option in ${language} via %s`, async (format) => {
      await i18n.changeLanguage(language);
      const cooking = ['waxy', 'mostly_waxy', 'floury'];
      const maturity = ['very_early', 'early', 'medium_early', 'medium_late', 'late'];
      const crops = maturity.map((value, index) => ({
        id: index + 1, name: 'Potato', variety: `Example ${index}`,
        specific_property_profile: profile,
        specific_properties: { cooking_type: cooking[index % cooking.length], maturity_group: value },
      } as Crop));
      const data = buildSpreadsheetFile(buildSheetData(crops, i18n.getFixedT(language, 'crops')), format);
      await i18n.changeLanguage('de');
      const result = await parseSpreadsheetFile(new File([data as BlobPart], `properties.${format}`));
      expect(result.warnings).toEqual([]);
      expect(result.entries.map((entry) => ({
        cooking_type: entry['specific_properties.cooking_type'], maturity_group: entry['specific_properties.maturity_group'],
      }))).toEqual(crops.map((crop) => crop.specific_properties));
    });
  }
});
