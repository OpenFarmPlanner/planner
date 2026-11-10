import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CropForm } from '../crops/CropForm';
import type { Crop } from '../api/types';

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const { cropDuplicateCheckMock, publicCropListMock, supplierListMock } = vi.hoisted(() => ({
  cropDuplicateCheckMock: vi.fn().mockResolvedValue({ data: { exists: false } }),
  publicCropListMock: vi.fn().mockResolvedValue({ data: { results: [] } }),
  supplierListMock: vi.fn().mockResolvedValue({ data: { results: [] } }),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      duplicateCheck: cropDuplicateCheckMock,
    },
    publicCropAPI: {
      ...actual.publicCropAPI,
      list: publicCropListMock,
    },
    plantFamilyAPI: {
      list: vi.fn().mockResolvedValue({
        data: [
          { botanical_name: 'Apiaceae', display_name: 'Carrot family', translations: { en: 'Carrot family' }, default_rotation_break_years: 3 },
          { botanical_name: 'Asteraceae', display_name: 'Daisy family', translations: { en: 'Daisy family' }, default_rotation_break_years: 2 },
        ],
      }),
    },
    supplierAPI: {
      list: supplierListMock,
      listAll: async () => (await supplierListMock()).data,
    },
  };
});

const SPECIES_CROP: Crop = {
  id: 1,
  name: 'Karotte',
  variety: '',
  crop_family: 'Apiaceae',
  nutrient_demand: 'medium',
  row_spacing_cm: 30,
};

// A species-linked pair: the general Kultur plus a Sorte that overrides nothing,
// so the API reports every value as resolved from the Kultur
// (see CropSerializer.effective_values).
const LINKED_SPECIES_CROP: Crop = {
  id: 3,
  name: 'Pastinake',
  variety: '',
  crop_species: 7,
  crop_family: 'Apiaceae',
  nutrient_demand: 'medium',
  row_spacing_cm: 30,
};

const INHERITING_VARIETY_CROP: Crop = {
  id: 4,
  name: 'Pastinake',
  variety: 'Halblange',
  crop_species: 7,
  general_crop: LINKED_SPECIES_CROP.id,
  inherited_fields: ['crop_family', 'nutrient_demand', 'row_spacing_cm'],
  effective_values: {
    crop_family: 'Apiaceae',
    nutrient_demand: 'medium',
    row_spacing_cm: 30,
  },
};

const VARIETY_CROP: Crop = {
  id: 2,
  name: 'Karotte',
  variety: 'Nantaise',
  crop_family: 'Asteraceae',
  nutrient_demand: 'medium',
  row_spacing_cm: 40,
};

// The variety highlight paints the outlined input's own background.
const backgroundOf = (input: HTMLElement): string => {
  const root = input.closest('.MuiOutlinedInput-root');
  if (!root) throw new Error('outlined input root not found');
  return window.getComputedStyle(root).backgroundColor;
};

describe('CropForm variety override highlighting', () => {
  beforeEach(() => {
    cropDuplicateCheckMock.mockClear();
    publicCropListMock.mockClear();
    supplierListMock.mockClear();
    supplierListMock.mockResolvedValue({ data: { results: [] } });
  });

  it('shows the legend and highlights only fields that override the species crop, without hover tooltips', async () => {
    const user = userEvent.setup({ delay: null });

    render(
      <CropForm
        crop={VARIETY_CROP}
        crops={[SPECIES_CROP, VARIETY_CROP]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());

    expect(screen.getByText('hierarchy.ownValueLegendSample')).toBeInTheDocument();

    const cropFamilyField = screen.getByLabelText('form.cropFamily');
    const rowSpacingField = screen.getByLabelText('form.rowSpacingCm');
    const nutrientDemandLabel = screen.getAllByText('form.nutrientDemand').find((el) => el.tagName === 'LABEL');
    const nutrientDemandFormControl = nutrientDemandLabel?.closest('.MuiFormControl-root');
    if (!nutrientDemandFormControl) {
      throw new Error('nutrient demand FormControl not found');
    }
    const nutrientDemandField = within(nutrientDemandFormControl as HTMLElement).getByRole('combobox');

    // Overridden fields (family 'Asteraceae', row spacing 40) carry the
    // highlight; the inherited nutrient demand does not.
    const highlight = backgroundOf(cropFamilyField);
    expect(highlight).not.toBe(backgroundOf(nutrientDemandField));
    expect(backgroundOf(rowSpacingField)).toBe(highlight);

    // Neither an overridden nor an inherited field explains itself on hover.
    for (const field of [cropFamilyField, rowSpacingField, nutrientDemandField]) {
      await user.hover(field);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  }, 20000);

  it('does not show the legend or any override tooltip when editing a species-level crop', async () => {
    render(
      <CropForm
        crop={SPECIES_CROP}
        crops={[SPECIES_CROP, VARIETY_CROP]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());

    expect(screen.queryByText('hierarchy.ownValueLegendSample')).not.toBeInTheDocument();
  });

  it('does not show the legend when no crops list is provided (e.g. public library form)', async () => {
    render(
      <CropForm
        crop={VARIETY_CROP}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());

    expect(screen.queryByText('hierarchy.ownValueLegendSample')).not.toBeInTheDocument();
  });

  it('shows the general crop value in a field the variety does not override, without highlighting it', async () => {
    const user = userEvent.setup({ delay: null });

    render(
      <CropForm
        crop={INHERITING_VARIETY_CROP}
        crops={[LINKED_SPECIES_CROP, INHERITING_VARIETY_CROP]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());

    // A non-invariant inherited field (row spacing) still shows the Kultur's
    // value as a real field value (no placeholder), without the highlight.
    const rowSpacingField = screen.getByLabelText('form.rowSpacingCm');
    expect(rowSpacingField).toHaveValue(30);
    expect(rowSpacingField).not.toHaveAttribute('placeholder', '30');
    expect(rowSpacingField).toBeEnabled();
    expect(backgroundOf(rowSpacingField)).toBe(backgroundOf(screen.getByLabelText('form.distanceWithinRowCm')));

    await user.click(rowSpacingField);
    await user.hover(rowSpacingField);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  }, 20000);

  it('renders the species-invariant fields read-only for a species-linked Sorte', async () => {
    render(
      <CropForm
        crop={INHERITING_VARIETY_CROP}
        crops={[LINKED_SPECIES_CROP, INHERITING_VARIETY_CROP]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());

    const cropFamilyField = screen.getByLabelText('form.cropFamily');
    await waitFor(() => expect(cropFamilyField).toHaveValue('Carrot family'));
    expect(cropFamilyField).toBeDisabled();
    expect(screen.getByLabelText('form.rotationBreakYears')).toBeDisabled();
    expect(screen.getByLabelText('form.cropRotationInheritedTooltip')).toBeInTheDocument();
  }, 20000);

  it('does not turn a displayed inherited value into an own override on save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CropForm
        crop={INHERITING_VARIETY_CROP}
        crops={[LINKED_SPECIES_CROP, INHERITING_VARIETY_CROP]}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());

    // Set an own value in a field the Kultur does not supply, so the form is
    // dirty and actually submits.
    fireEvent.change(screen.getByLabelText('form.propagationDurationDays'), { target: { value: '14' } });
    const saveButton = screen.getByRole('button', { name: 'form.save' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({
      propagation_duration_days: 14,
      crop_family: null,
      nutrient_demand: '',
      row_spacing_cm: undefined,
    }));
  });

  it('keeps an inherited list field a list when it stays inherited on save (#905)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const variety: Crop = {
      ...INHERITING_VARIETY_CROP,
      inherited_fields: [...(INHERITING_VARIETY_CROP.inherited_fields ?? []), 'tags'],
      effective_values: { ...INHERITING_VARIETY_CROP.effective_values, tags: ['Wurzelgemüse'] },
    };

    render(
      <CropForm
        crop={variety}
        crops={[LINKED_SPECIES_CROP, variety]}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());
    fireEvent.change(screen.getByLabelText('form.propagationDurationDays'), { target: { value: '14' } });
    const saveButton = screen.getByRole('button', { name: 'form.save' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].tags).toEqual([]);
  });

  it('keeps an edited non-invariant inherited field as the variety\'s own value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CropForm
        crop={INHERITING_VARIETY_CROP}
        crops={[LINKED_SPECIES_CROP, INHERITING_VARIETY_CROP]}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());

    fireEvent.change(screen.getByLabelText('form.rowSpacingCm'), { target: { value: '55' } });
    const saveButton = screen.getByRole('button', { name: 'form.save' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ row_spacing_cm: 55 }));
  });
});

describe('CropForm section order', () => {
  const SECTION_HEADINGS = [
    'form.generalInfoSectionTitle',
    'form.sectionCropRotation',
    'form.sectionTiming',
    'form.sectionPlanting',
    'form.sectionYield',
    'form.seedRateSectionTitle',
    'timingWindows.sectionTitle',
    'germination.title',
    'siteHealth.title',
    'companions.title',
    'form.displayColor',
    'form.notes',
  ];

  const renderedSectionHeadings = (): string[] => screen.getAllByRole('heading', { level: 6 })
    .map((heading) => heading.textContent ?? '')
    .filter((text) => SECTION_HEADINGS.includes(text));

  it.each([
    ['variety', VARIETY_CROP],
    ['crop', SPECIES_CROP],
  ] as const)('shows the same section order in the %s form', async (formKind, crop) => {
    render(
      <CropForm
        crop={crop}
        crops={[SPECIES_CROP, VARIETY_CROP]}
        formKind={formKind}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());
    expect(renderedSectionHeadings()).toEqual(SECTION_HEADINGS);
  });

  it('places the harvest duration in the timing section after propagation and growth duration', async () => {
    render(
      <CropForm
        crop={VARIETY_CROP}
        crops={[SPECIES_CROP, VARIETY_CROP]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());
    const ordered = [
      screen.getByRole('heading', { name: 'form.sectionTiming' }),
      screen.getByLabelText('form.propagationDurationDays'),
      screen.getByLabelText('form.growthDurationDays'),
      screen.getByLabelText('form.harvestDurationDays'),
      screen.getByRole('heading', { name: 'form.sectionPlanting' }),
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index - 1].compareDocumentPosition(ordered[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText('form.sectionHarvest')).not.toBeInTheDocument();
  });
});
