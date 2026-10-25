import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CropForm } from '../crops/CropForm';
import type { Crop, PublicCrop } from '../api/types';
import type { PublicCropSpeciesOption } from '../crops/publicCropNameSuggestions';
import type { GetLibraryFieldPinProps } from '../crops/libraryFieldPinProps';

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const { cropDuplicateCheckMock, seedRateConstraintsMock, publicCropListMock, supplierCreateMock, supplierListMock } = vi.hoisted(() => ({
  cropDuplicateCheckMock: vi.fn().mockResolvedValue({ data: { exists: false } }),
  seedRateConstraintsMock: vi.fn().mockResolvedValue({
    data: {
      units: {
        g_per_m2: { value_type: 'number', step: 0.001, minimum: 0.001 },
        g_per_lfm: { value_type: 'number', step: 0.001, minimum: 0.001 },
        seeds_per_m2: { value_type: 'number', step: 0.001, minimum: 0.001 },
        seeds_per_lfm: { value_type: 'number', step: 0.001, minimum: 0.001 },
        seeds_per_plant: { value_type: 'integer', step: 1, minimum: 1 },
      },
    },
  }),
  publicCropListMock: vi.fn().mockResolvedValue({ data: { results: [] } }),
  supplierCreateMock: vi.fn(),
  supplierListMock: vi.fn().mockResolvedValue({ data: { results: [] } }),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      duplicateCheck: cropDuplicateCheckMock,
      seedRateConstraints: seedRateConstraintsMock,
    },
    publicCropAPI: {
      ...actual.publicCropAPI,
      list: publicCropListMock,
    },
    supplierAPI: {
      list: supplierListMock,
      create: supplierCreateMock,
    },
  };
});

vi.mock('../crops/sections/BasicInfoSection', () => ({
  BasicInfoSection: ({
    formData,
    errors,
    identityHint,
    onChange,
    showVarietyField = true,
    showFirstVarietyField = false,
    firstVarietyName = '',
    onFirstVarietyNameChange,
    nameOptions = [],
    onNameSearchChange,
    onNameOptionSelect,
    varietyOptions = [],
    onVarietyCommit,
    firstVarietyOptions = [],
    onFirstVarietyCommit,
    identityRowControl,
    existingCropHint,
  }: {
    formData: Partial<Crop>;
    errors: Record<string, string>;
    identityHint?: ReactNode;
    onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
    showVarietyField?: boolean;
    showFirstVarietyField?: boolean;
    firstVarietyName?: string;
    onFirstVarietyNameChange?: (value: string) => void;
    nameOptions?: PublicCropSpeciesOption[];
    onNameSearchChange?: (value: string) => void;
    onNameOptionSelect?: (option: PublicCropSpeciesOption | null) => void;
    varietyOptions?: string[];
    onVarietyCommit?: (variety: string, reason?: 'selectOption') => void;
    firstVarietyOptions?: string[];
    onFirstVarietyCommit?: (variety: string, reason?: 'selectOption') => void;
    identityRowControl?: ReactNode;
    existingCropHint?: ReactNode;
  }) => (
    <div>
      <input
        aria-label="name-input"
        value={formData.name ?? ''}
        onChange={(event) => {
          onNameSearchChange?.(event.target.value);
          onChange('name', event.target.value);
          onNameOptionSelect?.(null);
        }}
      />
      {nameOptions[0] ? (
        <button
          type="button"
          onClick={() => {
            onChange('name', nameOptions[0].name);
            onNameOptionSelect?.(nameOptions[0]);
          }}
        >
          select-name-option
        </button>
      ) : null}
      {errors.name ? <span>{errors.name}</span> : null}
      {showVarietyField ? (
        <input
          aria-label="variety-input"
          value={formData.variety ?? ''}
          onChange={(event) => onChange('variety', event.target.value)}
        />
      ) : null}
      {showVarietyField && varietyOptions[0] ? (
        <button type="button" onClick={() => onVarietyCommit?.(varietyOptions[0], 'selectOption')}>
          select-variety-option
        </button>
      ) : null}
      {errors.variety ? <span>{errors.variety}</span> : null}
      {showFirstVarietyField ? (
        <input
          aria-label="first-variety-input"
          value={firstVarietyName}
          onChange={(event) => onFirstVarietyNameChange?.(event.target.value)}
        />
      ) : null}
      {showFirstVarietyField && firstVarietyOptions[0] ? (
        <button type="button" onClick={() => onFirstVarietyCommit?.(firstVarietyOptions[0], 'selectOption')}>
          select-first-variety-option
        </button>
      ) : null}
      {identityRowControl}
      {showFirstVarietyField ? existingCropHint : null}
      {identityHint}
    </div>
  ),
}));

vi.mock('../crops/sections/SpacingSection', () => ({
  SpacingSection: ({ formData, onChange }: { formData: Partial<Crop>; onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void }) => (
    <input
      aria-label="row-spacing-input"
      value={formData.row_spacing_cm ?? ''}
      onChange={(event) => onChange('row_spacing_cm', Number(event.target.value))}
    />
  ),
}));

vi.mock('../crops/sections/TimingSection', () => ({
  TimingSection: ({ getFieldPinProps }: { getFieldPinProps?: GetLibraryFieldPinProps }) => (
    <>{getFieldPinProps?.('growth_duration_days')?.button ?? null}</>
  ),
}));
vi.mock('../crops/sections/HarvestSection', () => ({ HarvestSection: () => null }));
vi.mock('../crops/sections/SeedingSection', () => ({
  SeedingSection: ({ formData, onChange }: { formData: Partial<Crop>; onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void }) => (
    <input
      aria-label="thousand-kernel-input"
      value={formData.thousand_kernel_weight_g ?? ''}
      onChange={(event) => onChange('thousand_kernel_weight_g', event.target.value === '' ? undefined : Number(event.target.value))}
    />
  ),
}));
vi.mock('../crops/sections/ColorSection', () => ({ ColorSection: () => null }));
vi.mock('../crops/sections/NotesSection', () => ({ NotesSection: () => null }));

const CROP_A: Crop = {
  id: 1,
  name: 'Karotte',
  variety: 'Nantaise',
  supplier: { id: 10, name: 'Bingenheimer' },
};

const CROP_B: Crop = {
  id: 2,
  name: 'Salat',
  variety: 'Batavia',
  supplier: { id: 11, name: 'Dreschflegel' },
};

const dispatchSaveShortcut = (options: { metaKey?: boolean; repeat?: boolean } = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: !options.metaKey,
    key: 's',
    metaKey: Boolean(options.metaKey),
    repeat: Boolean(options.repeat),
  });
  fireEvent(window, event);
  return event;
};

describe('CropForm', () => {
  beforeEach(() => {
    cropDuplicateCheckMock.mockReset();
    cropDuplicateCheckMock.mockResolvedValue({ data: { exists: false } });
    seedRateConstraintsMock.mockReset();
    seedRateConstraintsMock.mockResolvedValue({
      data: {
        units: {
          g_per_m2: { value_type: 'number', step: 0.001, minimum: 0.001 },
          g_per_lfm: { value_type: 'number', step: 0.001, minimum: 0.001 },
          seeds_per_m2: { value_type: 'number', step: 0.001, minimum: 0.001 },
          seeds_per_lfm: { value_type: 'number', step: 0.001, minimum: 0.001 },
          seeds_per_plant: { value_type: 'integer', step: 1, minimum: 1 },
        },
      },
    });
    publicCropListMock.mockReset();
    publicCropListMock.mockResolvedValue({ data: { results: [] } });
    supplierCreateMock.mockReset();
    supplierCreateMock.mockResolvedValue({
      data: { id: 42, name: 'Reinsaat', homepage_url: 'https://reinsaat.at', allowed_domains: [] },
    });
    supplierListMock.mockReset();
    supplierListMock.mockResolvedValue({ data: { results: [] } });
  });

  it('seeds the Name field from the current species name, not a stale crop.name', async () => {
    render(
      <CropForm
        crop={{ ...CROP_A, name: 'Ackerbohne', crop_species: 5, crop_display_name: '2' }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByLabelText('name-input')).toHaveValue('2');
  });

  it('saves the untouched canonical name, not the displayed translation, when the Name field was not edited', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CropForm
        crop={{ ...CROP_A, name: 'Kürbis', crop_species: 5, crop_display_name: 'Pumpkin' }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByLabelText('name-input')).toHaveValue('Pumpkin');
    // Touch an unrelated field so the form is dirty and actually submits,
    // without going through the name/variety duplicate-check debounce.
    fireEvent.change(screen.getByLabelText('thousand-kernel-input'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kürbis' }), undefined);
  });

  const PINNED_CROP = {
    ...CROP_A,
    growth_duration_days: 80,
    harvest_duration_days: 20,
    source_public_crop: 9,
    library_pinned_fields: ['growth_duration_days'],
    library_pinnable_fields: ['growth_duration_days', 'harvest_duration_days'],
    library_pinned_values: { growth_duration_days: 60 },
  };

  it('shows a pin only at pinned fields, without a helper line', () => {
    render(<CropForm crop={PINNED_CROP} onSave={vi.fn()} onCancel={() => {}} />);

    const pins = screen.getAllByTestId('crop-form-library-pin');
    expect(pins).toHaveLength(1);
    expect(pins[0]).toHaveAccessibleName('library.pin.ariaLabel');
    expect(screen.queryByText(/library\.pin\.helper/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'library.pin.pin' })).not.toBeInTheDocument();
  });

  it('opens a popover on the pin and releases the pin only via "Fixierung lösen", applied on save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CropForm crop={PINNED_CROP} onSave={onSave} onCancel={() => {}} />);

    fireEvent.click(screen.getByTestId('crop-form-library-pin'));
    const popover = await screen.findByTestId('crop-form-library-pin-popover');
    expect(popover).toHaveTextContent('library.pin.popoverTitle');
    // Opening the popover changes nothing yet.
    expect(screen.getByTestId('crop-form-library-pin')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'library.pin.unpin' }));
    await waitFor(() => expect(screen.queryByTestId('crop-form-library-pin')).not.toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ library_pinned_fields: [] }),
      undefined,
    );
  });

  it('closes the pin popover with Escape and keeps the pin', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CropForm crop={PINNED_CROP} onSave={onSave} onCancel={() => {}} />);

    fireEvent.click(screen.getByTestId('crop-form-library-pin'));
    const popover = await screen.findByTestId('crop-form-library-pin-popover');
    fireEvent.keyDown(popover, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('crop-form-library-pin-popover')).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('thousand-kernel-input'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ library_pinned_fields: ['growth_duration_days'] }),
      undefined,
    );
  });

  it('never shows a pin on an inherited field', () => {
    render(
      <CropForm
        crop={{
          ...PINNED_CROP,
          inherited_fields: ['growth_duration_days'],
        }}
        onSave={vi.fn()}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByTestId('crop-form-library-pin')).not.toBeInTheDocument();
  });

  it('offers no pin for a crop without a library link', () => {
    render(
      <CropForm
        crop={{ ...CROP_A, growth_duration_days: 80, library_pinnable_fields: [] }}
        onSave={vi.fn()}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByTestId('crop-form-library-pin')).not.toBeInTheDocument();
  });

  it('saves an actual edit to the Name field verbatim', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CropForm
        crop={{ ...CROP_A, name: 'Kürbis', crop_species: 5, crop_display_name: 'Pumpkin' }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Butternut' } });

    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Butternut', variety: 'Nantaise', exclude_id: 1 },
      expect.any(AbortSignal),
    ));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Butternut' }), undefined);
  });

  it('falls back to crop.name when there is no linked species', async () => {
    render(
      <CropForm
        crop={{ ...CROP_A, name: 'Karotte', crop_species: null, crop_display_name: undefined }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByLabelText('name-input')).toHaveValue('Karotte');
  });

  it('renders supplier selection states based on supplier availability', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [] } });

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(supplierListMock).toHaveBeenCalled());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('form.noSuppliers')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'form.createSuppliers' }));
    expect(await screen.findByRole('heading', { name: 'form.createSuppliers' })).toBeInTheDocument();
  });

  it('opens supplier creation without navigation and preserves crop changes when cancelled', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [] } });

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'form.createSuppliers' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Neue Karotte' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.createSuppliers' }));

    expect(await screen.findByRole('heading', { name: 'form.createSuppliers' })).toBeInTheDocument();
    expect(screen.getByLabelText('name-input')).toHaveValue('Neue Karotte');

    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Reinsaat' } });
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'form.createSuppliers' })).not.toBeInTheDocument();
    });

    expect(supplierCreateMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('name-input')).toHaveValue('Neue Karotte');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('creates a supplier inline, selects it, and keeps edited crop fields dirty', async () => {
    supplierListMock
      .mockResolvedValueOnce({ data: { results: [] } })
      .mockResolvedValueOnce({
        data: { results: [{ id: 42, name: 'Reinsaat', homepage_url: 'https://reinsaat.at', allowed_domains: [] }] },
      });
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'form.createSuppliers' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Neue Karotte' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.createSuppliers' }));
    fireEvent.change(await screen.findByLabelText('name'), { target: { value: 'Reinsaat' } });
    fireEvent.change(screen.getByLabelText('homepage'), { target: { value: 'reinsaat.at' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.createSuppliers' }));

    await waitFor(() => expect(supplierCreateMock).toHaveBeenCalledTimes(1));
    expect(supplierCreateMock).toHaveBeenCalledWith('Reinsaat', 'https://reinsaat.at', []);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'form.createSuppliers' })).not.toBeInTheDocument());

    const supplierSelect = await screen.findByRole('combobox');
    await waitFor(() => expect(supplierSelect).toHaveTextContent('Reinsaat'));
    expect(screen.getByLabelText('name-input')).toHaveValue('Neue Karotte');
    expect(screen.getByText('messages.unsavedChanges')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: 'form.save' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({
      name: 'Neue Karotte',
      supplier_data: [
        expect.objectContaining({
          supplier_id: 42,
          supplier: expect.objectContaining({ id: 42, name: 'Reinsaat' }),
          supplier_name: 'Reinsaat',
        }),
      ],
    }));
  });

  it('keeps supplier creation open with entered values after an API error', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [] } });
    supplierCreateMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { name: ['Ein Lieferant mit diesem Namen existiert bereits.'] } },
    });

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'form.createSuppliers' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'form.createSuppliers' }));
    fireEvent.change(await screen.findByLabelText('name'), { target: { value: 'Reinsaat' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.createSuppliers' }));

    expect(await screen.findByText('Ein Lieferant mit diesem Namen existiert bereits.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'form.createSuppliers' })).toBeInTheDocument();
    expect(screen.getByLabelText('name')).toHaveValue('Reinsaat');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('prevents duplicate supplier creation from double submit clicks', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [] } });
    let resolveCreate: (value: { data: { id: number; name: string; homepage_url: string; allowed_domains: string[] } }) => void = () => {};
    supplierCreateMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'form.createSuppliers' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'form.createSuppliers' }));
    fireEvent.change(await screen.findByLabelText('name'), { target: { value: 'Reinsaat' } });
    const submitButton = screen.getByRole('button', { name: 'form.createSuppliers' });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(supplierCreateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({ data: { id: 42, name: 'Reinsaat', homepage_url: '', allowed_domains: [] } });
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'form.createSuppliers' })).not.toBeInTheDocument());
  });

  it('closes only the supplier dialog on Escape', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [] } });

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'form.createSuppliers' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'form.createSuppliers' }));
    expect(await screen.findByRole('heading', { name: 'form.createSuppliers' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'form.createSuppliers' })).not.toBeInTheDocument());
    // CROP_A has a variety, so this is a variety-level edit (formKind
    // defaults to 'variety' for backward compatibility with callers that
    // don't pass it, which is correct here).
    expect(screen.getByRole('heading', { name: 'form.editVarietyTitle' })).toBeInTheDocument();
  });

  it('shows only real suppliers in the supplier dropdown when supplier options are available', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [{ id: 99, name: 'New Supplier' }] } });

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'New Supplier' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'form.supplierPlaceholder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'form.newSupplierOption' })).not.toBeInTheDocument();
  });

  it('falls back to empty supplier selection when saved supplier is not in options', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [{ id: 99, name: 'Different Supplier' }] } });

    render(
      <CropForm
        crop={{
          ...CROP_A,
          supplier_data: [{ supplier_id: 10, supplier_name: 'Bingenheimer', packaging_sizes: [] }],
        }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(screen.getByRole('combobox')).toHaveTextContent('form.supplierPlaceholder');
  });

  it('saves the newly selected supplier in supplier data rows', async () => {
    supplierListMock.mockResolvedValueOnce({
      data: {
        results: [
          { id: 10, name: 'Lieferant2' },
          { id: 11, name: 'Reinsaat' },
        ],
      },
    });
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CropForm
        crop={{
          ...CROP_A,
          supplier_data: [
            {
              id: 77,
              supplier: { id: 10, name: 'Lieferant2' },
              supplier_id: 10,
              supplier_name: 'Lieferant2',
              packaging_sizes: [{ size_value: 25, size_unit: 'g' }],
            },
          ],
        }}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText('Lieferant2')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText('Lieferant2'));
    fireEvent.click(screen.getByRole('option', { name: 'Reinsaat' }));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      supplier_data: [
        expect.objectContaining({
          id: 77,
          supplier: { id: 11, name: 'Reinsaat' },
          supplier_id: 11,
          supplier_name: 'Reinsaat',
        }),
      ],
    }), undefined);
  });

  it('loads all existing supplier rows when editing a crop', async () => {
    supplierListMock.mockResolvedValueOnce({
      data: {
        results: [
          { id: 10, name: 'Bingenheimer' },
          { id: 11, name: 'Dreschflegel' },
        ],
      },
    });

    render(
      <CropForm
        crop={{
          ...CROP_A,
          supplier_data: [
            { supplier_id: 10, supplier_name: 'Bingenheimer', packaging_sizes: [{ size_value: 25, size_unit: 'g' }] },
            { supplier_id: 11, supplier_name: 'Dreschflegel', packaging_sizes: [{ size_value: 50, size_unit: 'g' }] },
          ],
        }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Bingenheimer')).toBeInTheDocument();
      expect(screen.getByText('Dreschflegel')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('25')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument();
  });

  it('renders separated general and supplier-specific sections', () => {
    render(<CropForm crop={CROP_A} onSave={vi.fn().mockResolvedValue(undefined)} onCancel={() => {}} />);

    expect(screen.getByText('form.generalInfoSectionTitle')).toBeInTheDocument();
    expect(screen.getByText('form.supplierDataSectionTitle')).toBeInTheDocument();
  });

  it('keeps supplier information rows compact without stretch layout', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [{ id: 10, name: 'Bingenheimer' }] } });

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ supplier_id: 10, supplier_name: 'Bingenheimer', packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />,
    );

    const row = await screen.findByTestId('crop-supplier-data-row');
    expect(row).toHaveStyle({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      flexGrow: '0',
      minHeight: '0',
    });
  });

  it('shows only a compact hint instead of supplier fields while no supplier is selected', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [{ id: 10, name: 'Bingenheimer' }] } });

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />,
    );

    expect(await screen.findByTestId('crop-supplier-data-hint')).toHaveTextContent('form.supplierDataSelectSupplierHint');
    expect(screen.queryByLabelText('form.supplierProductNameLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('form.seedPackagesLabel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'form.addSeedPackage' })).not.toBeInTheDocument();
    // The row stays removable even without a selected supplier.
    expect(screen.getByRole('button', { name: 'form.removeSupplierData' })).toBeInTheDocument();
  });

  it('reveals the supplier fields once a supplier is selected', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [{ id: 10, name: 'Bingenheimer' }] } });

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />,
    );

    const supplierSelect = await screen.findByRole('combobox');
    fireEvent.mouseDown(supplierSelect);
    fireEvent.click(screen.getByRole('option', { name: 'Bingenheimer' }));

    expect(await screen.findByLabelText('form.supplierProductNameLabel')).toBeInTheDocument();
    expect(screen.getByText('form.seedPackagesLabel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'form.addSeedPackage' })).toBeInTheDocument();
    expect(screen.queryByTestId('crop-supplier-data-hint')).not.toBeInTheDocument();
  });

  it('lays out the supplier section vertically without reserving extra height', async () => {
    supplierListMock.mockResolvedValueOnce({ data: { results: [{ id: 10, name: 'Bingenheimer' }] } });

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ supplier_id: 10, supplier_name: 'Bingenheimer', packaging_sizes: [] }] }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />,
    );

    const section = await screen.findByTestId('crop-supplier-data-section');
    expect(section).toHaveStyle({
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
    });
    expect(section).not.toHaveStyle({ height: '100%' });
  });

  it('shows duplicate crop validation and blocks saving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    cropDuplicateCheckMock.mockResolvedValueOnce({ data: { exists: true } });

    render(<CropForm onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Karotte' } });
    fireEvent.change(screen.getByLabelText('variety-input'), { target: { value: 'Nantaise' } });

    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Karotte', variety: 'Nantaise', exclude_id: undefined },
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText('form.duplicateNameVariety')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'form.create' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('disables saving a crop while its name already exists in the project', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    cropDuplicateCheckMock.mockResolvedValueOnce({ data: { exists: false, name_exists: true } });

    render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Bohne' } });

    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Bohne', variety: '', exclude_id: undefined },
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText('form.cropNameConflict')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'form.create' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('allows saving an existing crop name when a first variety is entered', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    cropDuplicateCheckMock.mockResolvedValueOnce({ data: { exists: false, name_exists: true } });

    render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Bohne' } });
    fireEvent.change(screen.getByLabelText('first-variety-input'), { target: { value: 'Faraday' } });

    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Bohne', variety: '', exclude_id: undefined },
      expect.any(AbortSignal),
    ));
    await waitFor(() => expect(screen.getByRole('button', { name: 'form.create' })).not.toBeDisabled());
    expect(screen.queryByText('form.cropNameConflict')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('keeps free-text crop names private without requiring a public match', async () => {
    cropDuplicateCheckMock.mockResolvedValue({ data: { exists: false } });
    publicCropListMock.mockResolvedValue({ data: { results: [] } });

    render(
      <CropForm
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Karotte' } });
    fireEvent.change(screen.getByLabelText('variety-input'), { target: { value: 'Nantaise' } });

    await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith(
      { q: 'Karotte' },
      expect.any(AbortSignal),
    ));
    expect(screen.queryByText('form.publicCropSourceHint')).not.toBeInTheDocument();
  });

  it('offers no variety suggestions until the name matches an existing public crop species', async () => {
    publicCropListMock.mockResolvedValue({
      data: { results: [{
        id: 42,
        status: 'published',
        name: 'Tomate',
        display_name: 'Tomate',
        variety: 'Moneymaker',
        crop_species: 7,
        version: 3,
      } as PublicCrop] },
    });

    render(
      <CropForm
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Tomaten' } });
    await screen.findByRole('button', { name: 'select-name-option' });
    // Typed text ("Tomaten") does not exactly match the suggested species
    // ("Tomate") yet, so the variety field must stay free text.
    expect(screen.queryByRole('button', { name: 'select-variety-option' })).not.toBeInTheDocument();
    expect(publicCropListMock).not.toHaveBeenCalledWith(
      { crop_species: 7 },
      expect.any(AbortSignal),
    );
  });

  it('shows no library source hint when editing an already linked Kultur or Sorte', () => {
    const linked = { ...CROP_A, source_public_crop: 9, source_public_version: 2, origin_type: 'imported' as const };
    const { unmount } = render(<CropForm formKind="crop" crop={{ ...linked, variety: '' }} onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByTestId('crop-library-source-hint')).not.toBeInTheDocument();
    unmount();

    render(<CropForm formKind="variety" crop={linked} onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByTestId('crop-library-source-hint')).not.toBeInTheDocument();
  });

  it('shows the Kultur source hint after an entry is picked while editing a Kultur', async () => {
    cropDuplicateCheckMock.mockResolvedValue({ data: { exists: false } });
    publicCropListMock.mockResolvedValue({
      data: { results: [{
        id: 41,
        status: 'published',
        name: 'Tomate',
        display_name: 'Tomate',
        variety: '',
        crop_species: 7,
        version: 3,
      } as PublicCrop] },
    });

    render(<CropForm formKind="crop" crop={{ ...CROP_A, name: 'Tomate', variety: '' }} onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByTestId('crop-library-source-hint')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Tomaten' } });
    fireEvent.click(await screen.findByRole('button', { name: 'select-name-option' }));

    const hint = await screen.findByTestId('crop-library-source-hint');
    expect(hint).toHaveTextContent('form.publicCropSourceHint');
    expect(hint).not.toHaveTextContent('form.publicCropSourceHintVariety');
  });

  it('copies public crop base values when a suggestion is selected', async () => {
    cropDuplicateCheckMock.mockResolvedValue({ data: { exists: false } });
    publicCropListMock.mockResolvedValue({
      data: { results: [{
        id: 42,
        status: 'published',
        name: 'Tomate',
        display_name: 'Tomate',
        variety: 'Moneymaker',
        crop_species: 7,
        crop_family: 'Nachtschattengewächse',
        growth_duration_days: 90,
        row_spacing_m: 0.5,
        version: 3,
      } as PublicCrop] },
    });
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CropForm
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Tomaten' } });
    await screen.findByRole('button', { name: 'select-name-option' });
    fireEvent.click(screen.getByRole('button', { name: 'select-name-option' }));
    await screen.findByRole('button', { name: 'select-variety-option' });
    fireEvent.click(screen.getByRole('button', { name: 'select-variety-option' }));
    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Tomate', variety: 'Moneymaker', exclude_id: undefined },
      expect.any(AbortSignal),
    ));
    const saveButton = screen.getByRole('button', { name: 'form.create' });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Tomate',
      variety: 'Moneymaker',
      crop_species: 7,
      source_public_crop: 42,
      source_public_version: 3,
      crop_family: 'Nachtschattengewächse',
      growth_duration_days: 90,
      row_spacing_cm: 50,
      origin_type: 'imported',
    }), undefined);
    // The Add-variety dialog names the variety, as a neutral info (not the green highlight).
    const hint = screen.getByTestId('crop-library-source-hint');
    expect(hint).toHaveTextContent('form.publicCropSourceHintVariety');
    // Rendered without the app theme here, so the defaults stand in for the tokens.
    const { palette } = createTheme();
    expect(hint).toHaveStyle({ backgroundColor: palette.action.hover, color: palette.text.primary });
  });

  // Regression guard for the "Add crop" dialog, where no variety field exists
  // to select from: picking a Name suggestion must itself prefill and link,
  // otherwise the public library is unreachable from that dialog entirely.
  it('links the new Kultur to the species general entry when a name suggestion is selected', async () => {
    publicCropListMock.mockImplementation((params: { q?: string; crop_species?: number }) => Promise.resolve({
      data: {
        results: params.crop_species === 7
          ? [
            {
              id: 40,
              status: 'published',
              name: 'Tomate',
              display_name: 'Tomate',
              variety: '',
              crop_species: 7,
              crop_family: 'Nachtschattengewächse',
              growth_duration_days: 80,
              row_spacing_m: 0.6,
              version: 2,
            } as PublicCrop,
            {
              id: 42,
              status: 'published',
              name: 'Tomate',
              display_name: 'Tomate',
              variety: 'Moneymaker',
              crop_species: 7,
              version: 3,
            } as PublicCrop,
          ]
          : [{
            id: 42,
            status: 'published',
            name: 'Tomate',
            display_name: 'Tomate',
            variety: 'Moneymaker',
            crop_species: 7,
            version: 3,
          } as PublicCrop],
      },
    }));
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Tomaten' } });
    await screen.findByRole('button', { name: 'select-name-option' });
    fireEvent.click(screen.getByRole('button', { name: 'select-name-option' }));

    await waitFor(() => expect(screen.getByLabelText('row-spacing-input')).toHaveValue('60'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'form.create' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Tomate',
      variety: '',
      crop_species: 7,
      link_public_crop: 40,
      crop_family: 'Nachtschattengewächse',
      growth_duration_days: 80,
      row_spacing_cm: 60,
    }), undefined);
    // The link is created with the crop, not copied in as an import.
    expect(onSave.mock.calls[0][0].source_public_crop).toBeFalsy();
  });

  it('links only crop_species when the matched species has no general entry', async () => {
    publicCropListMock.mockResolvedValue({
      data: { results: [{
        id: 42,
        status: 'published',
        name: 'Tomate',
        display_name: 'Tomate',
        variety: 'Moneymaker',
        crop_species: 7,
        crop_family: 'Nachtschattengewächse',
        version: 3,
      } as PublicCrop] },
    });
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Tomaten' } });
    await screen.findByRole('button', { name: 'select-name-option' });
    fireEvent.click(screen.getByRole('button', { name: 'select-name-option' }));

    await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith(
      { crop_species: 7 },
      expect.any(AbortSignal),
    ));
    await waitFor(() => expect(screen.getByRole('button', { name: 'form.create' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedCrop] = onSave.mock.calls[0] as [Crop];
    expect(savedCrop.crop_species).toBe(7);
    expect(savedCrop.source_public_crop).toBeFalsy();
    expect(savedCrop.crop_family).toBeNull();
    expect(screen.queryByText('form.publicCropSourceHint')).not.toBeInTheDocument();
  });

  it('links the first variety to the library when its suggestion is selected', async () => {
    publicCropListMock.mockResolvedValue({
      data: { results: [{
        id: 42,
        status: 'published',
        name: 'Tomate',
        display_name: 'Tomate',
        variety: 'Moneymaker',
        crop_species: 7,
        growth_duration_days: 95,
        version: 3,
      } as PublicCrop] },
    });
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Tomate' } });
    await screen.findByRole('button', { name: 'select-first-variety-option' });
    const duplicateCheckCallsBeforeVarietySelect = cropDuplicateCheckMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'select-first-variety-option' }));
    // Picking the first-variety suggestion flips `hasFirstVarietyName`, which
    // re-triggers the debounced duplicate-name check (it factors into the
    // crop-name-conflict rule). Depending on timing, this either cancels an
    // in-flight name-only check and replaces it, or runs after it — either
    // way, wait for a check that reflects the post-selection state to land
    // before asserting the Create button is enabled. Otherwise a stale
    // "not disabled" read from the tail end of the superseded check can pass
    // a moment before the new debounce cycle disables it again.
    await waitFor(() => expect(cropDuplicateCheckMock.mock.calls.length).toBeGreaterThan(duplicateCheckCallsBeforeVarietySelect));
    await waitFor(() => expect(screen.getByRole('button', { name: 'form.create' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.anything(), {
      name: 'Moneymaker',
      draft: expect.objectContaining({
        variety: 'Moneymaker',
        source_public_crop: 42,
        source_public_version: 3,
        growth_duration_days: 95,
        origin_type: 'imported',
      }),
    });
  });

  it('offers no first-variety suggestions while the crop name is unmatched free text', async () => {
    publicCropListMock.mockResolvedValue({
      data: { results: [{
        id: 42,
        status: 'published',
        name: 'Tomate',
        display_name: 'Tomate',
        variety: 'Moneymaker',
        crop_species: 7,
        version: 3,
      } as PublicCrop] },
    });

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Tomaten' } });
    await screen.findByRole('button', { name: 'select-name-option' });
    expect(screen.queryByRole('button', { name: 'select-first-variety-option' })).not.toBeInTheDocument();
    // The field itself stays usable as free text.
    expect(screen.getByLabelText('first-variety-input')).toBeInTheDocument();
  });

  it('offers switching to the add-variety flow when the crop name already exists privately', async () => {
    const onSwitchToAddVariety = vi.fn();

    render(
      <CropForm
        formKind="crop"
        crops={[CROP_A, { id: 9, name: 'Karotte', variety: '' } as Crop]}
        onSave={vi.fn()}
        onCancel={() => {}}
        onSwitchToAddVariety={onSwitchToAddVariety}
      />
    );

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: ' karotte ' } });

    const hint = await screen.findByTestId('crop-existing-crop-hint');
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent('form.existingCropHint');
    fireEvent.click(screen.getByRole('button', { name: 'form.existingCropAddVarietyAction' }));

    // The species-level row is the correct parent for the add-variety flow.
    expect(onSwitchToAddVariety).toHaveBeenCalledWith(expect.objectContaining({ id: 9, variety: '' }));
  });

  it('turns the existing-crop hint into confirmation once a first variety is entered', async () => {
    render(
      <CropForm
        formKind="crop"
        crops={[{ id: 9, name: 'Karotte', variety: '' } as Crop]}
        onSave={vi.fn()}
        onCancel={() => {}}
        onSwitchToAddVariety={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Karotte' } });

    const hint = await screen.findByTestId('crop-existing-crop-hint');
    expect(hint).toHaveTextContent('form.existingCropHint');
    expect(screen.getByRole('button', { name: 'form.existingCropAddVarietyAction' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('first-variety-input'), { target: { value: 'Faraday' } });

    expect(await screen.findByTestId('crop-existing-crop-hint')).toHaveTextContent('form.existingCropFirstVarietyHint');
    expect(screen.queryByRole('button', { name: 'form.existingCropAddVarietyAction' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('first-variety-input'), { target: { value: '' } });

    expect(await screen.findByTestId('crop-existing-crop-hint')).toHaveTextContent('form.existingCropHint');
    expect(screen.getByRole('button', { name: 'form.existingCropAddVarietyAction' })).toBeInTheDocument();
  });

  it('shows no existing-crop hint for a name the project does not use yet', async () => {
    render(
      <CropForm
        formKind="crop"
        crops={[CROP_A]}
        onSave={vi.fn()}
        onCancel={() => {}}
        onSwitchToAddVariety={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Pastinake' } });

    await waitFor(() => expect(publicCropListMock).toHaveBeenCalled());
    expect(screen.queryByTestId('crop-existing-crop-hint')).not.toBeInTheDocument();
  });

  it('saves changed form data when editing a crop', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Neue Karotte' } });

    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Neue Karotte', variety: 'Nantaise', exclude_id: 1 },
      expect.any(AbortSignal),
    ));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      name: 'Neue Karotte',
      variety: 'Nantaise',
      supplier: { id: 10, name: 'Bingenheimer' },
    }), undefined);
  });

  it('hides the variety field and saves without one when formKind is crop', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);

    expect(screen.queryByLabelText('variety-input')).not.toBeInTheDocument();

    // A crop-level entry has no variety, so the name+variety duplicate check
    // (which requires both to be non-empty) never fires here — save directly.
    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Karotte' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Karotte', variety: '' }), undefined);
  });

  it('shows the optional first-variety field only when adding a new crop', () => {
    const { rerender } = render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByLabelText('first-variety-input')).toBeInTheDocument();

    rerender(<CropForm formKind="variety" onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByLabelText('first-variety-input')).not.toBeInTheDocument();

    rerender(<CropForm formKind="crop" crop={CROP_A} onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByLabelText('first-variety-input')).not.toBeInTheDocument();
  });

  it('saves the crop without a variety name when the first-variety field is left empty', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Karotte' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Karotte', variety: '' }), undefined);
  });

  it('passes the entered variety name alongside the crop when the first-variety field is filled in', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Karotte' } });
    fireEvent.change(screen.getByLabelText('first-variety-input'), { target: { value: 'Nantaise' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Karotte', variety: '' }),
      { name: 'Nantaise', draft: undefined },
    );
  });

  it('keeps the copy-defaults checkbox disabled in the crop form until a first variety was entered', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);

    const copyCheckbox = screen.getByRole('checkbox', { name: 'form.copyValuesToCrop' });
    expect(copyCheckbox).toBeDisabled();
    fireEvent.mouseOver(screen.getByText('form.copyValuesToCrop'));
    expect(await screen.findByText('form.copyValuesToCropDisabledTooltip')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('first-variety-input'), { target: { value: 'Nantaise' } });

    expect(copyCheckbox).not.toBeDisabled();
    expect(copyCheckbox).not.toBeChecked();
    fireEvent.click(copyCheckbox);
    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Karotte' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Karotte', variety: '' }),
      { name: 'Nantaise', draft: undefined, copyValuesToCrop: true },
    );
  });

  it('preserves the checked copy-defaults value when the first variety is cleared', () => {
    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);

    const copyCheckbox = screen.getByRole('checkbox', { name: 'form.copyValuesToCrop' });
    fireEvent.change(screen.getByLabelText('first-variety-input'), { target: { value: 'Nantaise' } });
    fireEvent.click(copyCheckbox);
    expect(copyCheckbox).toBeChecked();

    fireEvent.change(screen.getByLabelText('first-variety-input'), { target: { value: '' } });

    expect(copyCheckbox).toBeDisabled();
    expect(copyCheckbox).toBeChecked();
  });

  it('shows and still requires the variety field when formKind is variety', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm formKind="variety" onSave={onSave} onCancel={() => {}} />);

    expect(screen.getByLabelText('variety-input')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Karotte' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText('form.varietyRequired')).toBeInTheDocument();
  });

  it('only requests copying variety values to the general crop after explicit opt-in', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm formKind="variety" onSave={onSave} onCancel={() => {}} />);

    const copyCheckbox = screen.getByRole('checkbox', { name: 'form.copyValuesToCrop' });
    expect(copyCheckbox).not.toBeChecked();
    expect(copyCheckbox).toBeDisabled();
    fireEvent.change(screen.getByLabelText('variety-input'), { target: { value: 'Nantaise' } });
    expect(copyCheckbox).not.toBeDisabled();
    fireEvent.click(copyCheckbox);
    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Karotte' } });
    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ copy_values_to_crop: true }),
      undefined,
    );
  });

  it('pre-fills crop_species and name from initialDraft when adding a variety', () => {
    render(
      <CropForm
        formKind="variety"
        initialDraft={{ crop_species: 7, name: 'Karotte', variety: '' }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={() => {}}
      />
    );

    expect(screen.getByLabelText('name-input')).toHaveValue('Karotte');
    expect(screen.getByLabelText('variety-input')).toHaveValue('');
  });

  it('clears a variety field left matching its crop-prefilled baseline value on save, so it keeps inheriting from the crop', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CropForm
        formKind="variety"
        initialDraft={{ crop_species: 7, name: 'Karotte', variety: '', row_spacing_cm: 30 }}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    expect(screen.getByLabelText('row-spacing-input')).toHaveValue('30');
    fireEvent.change(screen.getByLabelText('variety-input'), { target: { value: 'Nantaise' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].row_spacing_cm).toBeUndefined();
  });

  it('keeps a variety field the user changed away from its crop-prefilled baseline value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CropForm
        formKind="variety"
        initialDraft={{ crop_species: 7, name: 'Karotte', variety: '', row_spacing_cm: 30 }}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText('variety-input'), { target: { value: 'Nantaise' } });
    fireEvent.change(screen.getByLabelText('row-spacing-input'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].row_spacing_cm).toBe(40);
  });

  it('closes without saving when an edited crop has no effective changes', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('treats trim-only text edits as unchanged when saving an edited crop', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={onCancel} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: '  Karotte  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('saves exactly once after a real edit and then treats the saved data as unchanged when reopened', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const { rerender } = render(<CropForm crop={CROP_A} onSave={onSave} onCancel={onCancel} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Neue Karotte' } });

    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Neue Karotte', variety: 'Nantaise', exclude_id: 1 },
      expect.any(AbortSignal),
    ));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    rerender(
      <CropForm
        crop={{ ...CROP_A, name: 'Neue Karotte' }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('saves the active crop edit dialog with Ctrl+S', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={() => {}} />);

    const nameInput = screen.getByLabelText('name-input');
    fireEvent.change(nameInput, { target: { value: 'Neue Karotte' } });
    nameInput.focus();

    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Neue Karotte', variety: 'Nantaise', exclude_id: 1 },
      expect.any(AbortSignal),
    ));
    await waitFor(() => expect(screen.getByRole('button', { name: 'form.save' })).not.toBeDisabled());
    const event = dispatchSaveShortcut();

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      name: 'Neue Karotte',
      variety: 'Nantaise',
    }), undefined);
  });

  it('saves the active crop edit dialog with Cmd+S', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={() => {}} />);

    const varietyInput = screen.getByLabelText('variety-input');
    fireEvent.change(varietyInput, { target: { value: 'Nantaise 2' } });
    varietyInput.focus();
    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Karotte', variety: 'Nantaise 2', exclude_id: 1 },
      expect.any(AbortSignal),
    ));
    await waitFor(() => expect(screen.getByRole('button', { name: 'form.save' })).not.toBeDisabled());
    const event = dispatchSaveShortcut({ metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('prevents browser save but does not submit when Ctrl+S save is disabled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    cropDuplicateCheckMock.mockResolvedValueOnce({ data: { exists: true } });

    render(<CropForm onSave={onSave} onCancel={() => {}} />);

    const nameInput = screen.getByLabelText('name-input');
    fireEvent.change(nameInput, { target: { value: 'Karotte' } });
    fireEvent.change(screen.getByLabelText('variety-input'), { target: { value: 'Nantaise' } });
    nameInput.focus();

    await screen.findByText('form.duplicateNameVariety');
    const event = dispatchSaveShortcut();

    expect(event.defaultPrevented).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('prevents browser save before any field receives focus in the edit dialog', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={onCancel} />);

    (document.activeElement as HTMLElement | null)?.blur();
    const event = dispatchSaveShortcut();

    expect(event.defaultPrevented).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not start duplicate saves when Ctrl+S is pressed repeatedly', async () => {
    let resolveSave: () => void = () => {};
    const onSave = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={() => {}} />);

    const nameInput = screen.getByLabelText('name-input');
    fireEvent.change(nameInput, { target: { value: 'Neue Karotte' } });
    nameInput.focus();
    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Neue Karotte', variety: 'Nantaise', exclude_id: 1 },
      expect.any(AbortSignal),
    ));
    await waitFor(() => expect(screen.getByRole('button', { name: 'form.save' })).not.toBeDisabled());
    const firstEvent = dispatchSaveShortcut();
    const secondEvent = dispatchSaveShortcut();

    expect(firstEvent.defaultPrevented).toBe(true);
    expect(secondEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    resolveSave();
  });

  it('keeps Enter behavior unchanged in crop edit inputs', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={() => {}} />);

    const nameInput = screen.getByLabelText('name-input');
    nameInput.focus();
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves spacing values for crop edit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm crop={CROP_B} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('row-spacing-input'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 2,
      name: 'Salat',
      variety: 'Batavia',
      row_spacing_cm: 35,
      supplier: { id: 11, name: 'Dreschflegel' },
    }), undefined);
  });

  it('saves thousand-kernel weight directly on crop data', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('thousand-kernel-input'), { target: { value: '4.2' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      thousand_kernel_weight_g: 4.2,
    }), undefined);
  });

  it('maps legacy seed_supplier into supplier field for validation and save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm crop={{ id: 3, name: 'Mangold', variety: 'Rainbow', seed_supplier: 'Legacy Seeds' }} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('row-spacing-input'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 3,
      supplier: expect.objectContaining({ name: 'Legacy Seeds' }),
      row_spacing_cm: 40,
    }), undefined);
  });

  it('resets form state when a different crop is opened for editing', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<CropForm crop={CROP_A} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Zwischenstand' } });

    rerender(<CropForm crop={CROP_B} onSave={onSave} onCancel={() => {}} />);

    expect(screen.getByLabelText('name-input')).toHaveValue('Salat');
    expect(screen.getByLabelText('variety-input')).toHaveValue('Batavia');

    fireEvent.change(screen.getByLabelText('row-spacing-input'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 2,
      name: 'Salat',
      variety: 'Batavia',
      row_spacing_cm: 42,
      supplier: { id: 11, name: 'Dreschflegel' },
    }), undefined);
  });

  it('renders save error inline instead of snackbar overlap', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Neue Karotte' } });
    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Neue Karotte', variety: 'Nantaise', exclude_id: 1 },
      expect.any(AbortSignal),
    ));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('messages.updateError')).toBeInTheDocument();
  });

  it('ignores empty supplier information rows when detecting changes', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ packaging_sizes: [] }] }}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('form.supplierDataMissingSupplier')).not.toBeInTheDocument();
  });

  it('blocks partially filled supplier information rows without a supplier', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CropForm
        crop={{ ...CROP_A, supplier_data: [{ supplier_product_name: 'Artikel ohne Lieferant', packaging_sizes: [] }] }}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText('name-input'), { target: { value: 'Neue Karotte' } });
    await waitFor(() => expect(cropDuplicateCheckMock).toHaveBeenCalledWith(
      { name: 'Neue Karotte', variety: 'Nantaise', exclude_id: 1 },
      expect.any(AbortSignal),
    ));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    expect(await screen.findByText('form.supplierDataMissingSupplier')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps focus inside the dialog when opened', async () => {
    render(<CropForm crop={CROP_A} onSave={vi.fn().mockResolvedValue(undefined)} onCancel={() => {}} />);

    const dialogRoot = document.querySelector('.MuiDialog-root') as HTMLElement | null;
    expect(dialogRoot).toBeTruthy();
    await waitFor(() => expect(dialogRoot).toContainElement(document.activeElement as HTMLElement));
  });

  it('keeps normal input keyboard handling without scrolling dialog content', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CropForm crop={CROP_A} onSave={onSave} onCancel={() => {}} />);
    const content = document.querySelector('.MuiDialogContent-root') as HTMLDivElement | null;
    expect(content).toBeTruthy();
    Object.defineProperty(content, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(content, 'scrollHeight', { value: 500, configurable: true });

    const nameInput = screen.getByLabelText('name-input');
    (nameInput as HTMLInputElement).focus();

    fireEvent.keyDown(nameInput, { key: 'ArrowDown' });
    fireEvent.keyDown(nameInput, { key: 'PageDown' });
    fireEvent.keyDown(nameInput, { key: ' ' });

    expect(content?.scrollTop).toBe(0);
  });

});
