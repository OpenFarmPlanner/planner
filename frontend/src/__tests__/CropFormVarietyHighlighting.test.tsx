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
    supplierAPI: {
      list: supplierListMock,
    },
  };
});

const SPECIES_CROP: Crop = {
  id: 1,
  name: 'Karotte',
  variety: '',
  crop_family: 'Doldenblütler',
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
  crop_family: 'Doldenblütler',
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
    crop_family: 'Doldenblütler',
    nutrient_demand: 'medium',
    row_spacing_cm: 30,
  },
};

const VARIETY_CROP: Crop = {
  id: 2,
  name: 'Karotte',
  variety: 'Nantaise',
  crop_family: 'Sonderfamilie',
  nutrient_demand: 'medium',
  row_spacing_cm: 40,
};

describe('CropForm variety override highlighting', () => {
  beforeEach(() => {
    cropDuplicateCheckMock.mockClear();
    publicCropListMock.mockClear();
    supplierListMock.mockClear();
    supplierListMock.mockResolvedValue({ data: { results: [] } });
  });

  it('shows the legend and highlights only fields that override the species crop', async () => {
    const user = userEvent.setup({ delay: null });

    render(
      <CropForm
        crop={VARIETY_CROP}
        crops={[SPECIES_CROP, VARIETY_CROP]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(supplierListMock).toHaveBeenCalled());

    expect(screen.getByText('hierarchy.ownValueLegendSample')).toBeInTheDocument();

    const cropFamilyField = screen.getByLabelText('form.cropFamily');
    const rowSpacingField = screen.getByLabelText('form.rowSpacingCm');
    const nutrientDemandLabel = screen.getAllByText('form.nutrientDemand').find((el) => el.tagName === 'LABEL');
    const nutrientDemandFormControl = nutrientDemandLabel?.closest('.MuiFormControl-root');
    if (!nutrientDemandFormControl) {
      throw new Error('nutrient demand FormControl not found');
    }
    const nutrientDemandField = within(nutrientDemandFormControl as HTMLElement).getByRole('combobox');

    // Reset DropdownAwareTooltip's suppression state: mounting the dialog
    // auto-focuses the (combobox-like) name field, which otherwise keeps
    // every tooltip suppressed for the rest of the test.
    await user.click(cropFamilyField);

    await user.hover(cropFamilyField);
    expect(await screen.findByRole('tooltip', {}, { timeout: 5000 })).toHaveTextContent('hierarchy.ownValueFieldTooltip');
    await user.unhover(cropFamilyField);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(), { timeout: 5000 });

    await user.hover(rowSpacingField);
    expect(await screen.findByRole('tooltip', {}, { timeout: 5000 })).toHaveTextContent('hierarchy.ownValueFieldTooltip');
    await user.unhover(rowSpacingField);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(), { timeout: 5000 });

    await user.hover(nutrientDemandField);
    expect(await screen.findByRole('tooltip', {}, { timeout: 5000 })).toHaveTextContent('hierarchy.inheritedFieldTooltip');
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

    await waitFor(() => expect(supplierListMock).toHaveBeenCalled());

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

    await waitFor(() => expect(supplierListMock).toHaveBeenCalled());

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

    await waitFor(() => expect(supplierListMock).toHaveBeenCalled());

    // A non-invariant inherited field (row spacing) still shows the Kultur's
    // value and keeps the inherited-field tooltip.
    const rowSpacingField = screen.getByLabelText('form.rowSpacingCm');
    expect(rowSpacingField).toHaveValue(30);
    expect(rowSpacingField).toBeEnabled();

    // CropForm focuses its first input one animation frame after mount. Wait
    // for that before clicking, or it can steal focus and close the tooltip.
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^form\.name/ })).toHaveFocus());

    await user.click(rowSpacingField);
    await user.hover(rowSpacingField);
    expect(await screen.findByRole('tooltip', {}, { timeout: 5000 })).toHaveTextContent('hierarchy.inheritedFieldTooltip');
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

    await waitFor(() => expect(supplierListMock).toHaveBeenCalled());

    const cropFamilyField = screen.getByLabelText('form.cropFamily');
    expect(cropFamilyField).toHaveValue('Doldenblütler');
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

    await waitFor(() => expect(supplierListMock).toHaveBeenCalled());

    // Set an own value in a field the Kultur does not supply, so the form is
    // dirty and actually submits.
    fireEvent.change(screen.getByLabelText('form.propagationDurationDays'), { target: { value: '14' } });
    const saveButton = screen.getByRole('button', { name: 'form.save' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({
      propagation_duration_days: 14,
      crop_family: '',
      nutrient_demand: '',
      row_spacing_cm: undefined,
    }));
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

    await waitFor(() => expect(supplierListMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('form.rowSpacingCm'), { target: { value: '55' } });
    const saveButton = screen.getByRole('button', { name: 'form.save' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ row_spacing_cm: 55 }));
  });
});
