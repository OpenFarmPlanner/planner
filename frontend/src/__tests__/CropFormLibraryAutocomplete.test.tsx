/**
 * Renders CropForm against the *real* BasicInfoSection.
 *
 * CropForm.test.tsx mocks that section away, so it verifies the form's
 * callbacks but not that the fields are actually wired to them. The Add-crop
 * dialog once lost its library prefill entirely — the Name field kept
 * rendering suggestions while the only code path that prefills and links moved
 * to a Variety field that `formKind="crop"` never renders — and every mocked
 * test still passed. These cases cover that gap at the DOM level.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CropForm } from '../crops/CropForm';
import type { PublicCrop } from '../api/types';

vi.mock('../i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
    cropAPI: { ...actual.cropAPI, duplicateCheck: cropDuplicateCheckMock },
    publicCropAPI: { ...actual.publicCropAPI, list: publicCropListMock },
    supplierAPI: { list: supplierListMock, create: vi.fn() },
  };
});

const GENERAL_TOMATO = {
  id: 40,
  status: 'published',
  name: 'Tomate',
  display_name: 'Tomate',
  variety: '',
  crop_species: 7,
  crop_family: 'Nachtschattengewächse',
  growth_duration_days: 80,
  version: 2,
} as PublicCrop;

const MONEYMAKER = {
  id: 42,
  status: 'published',
  name: 'Tomate',
  display_name: 'Tomate',
  variety: 'Moneymaker',
  crop_species: 7,
  version: 3,
} as PublicCrop;

const mockLibrary = (speciesResults: PublicCrop[]) => {
  publicCropListMock.mockImplementation((params: { q?: string; crop_species?: number }) => Promise.resolve({
    data: { results: params.crop_species === 7 ? speciesResults : [MONEYMAKER] },
  }));
};

const getNameInput = () => screen.getByRole('combobox', { name: /form\.name/ });

describe('CropForm library autocomplete (real BasicInfoSection)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cropDuplicateCheckMock.mockResolvedValue({ data: { exists: false } });
    supplierListMock.mockResolvedValue({ data: { results: [] } });
    publicCropListMock.mockResolvedValue({ data: { results: [] } });
  });

  it('suggests public crop species while typing in the Add-crop dialog', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(getNameInput(), { target: { value: 'Toma' } });

    await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith(
      { q: 'Toma' },
      expect.any(AbortSignal),
    ));
    const options = await screen.findAllByRole('option');
    // Species-level only — never a "Species · Variety" combination.
    expect(options.map((option) => option.textContent)).toEqual(['Tomate']);
  });

  it('links immediately and fills empty fields when a name suggestion is picked from the list', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(getNameInput(), { target: { value: 'Toma' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Tomate' }));

    // A list pick is an explicit choice: the linked state shows right away,
    // without the "Mit Kulturbibliothek verknüpfen" button.
    await screen.findByText('form.publicCropLinkedHint');
    expect(screen.getByRole('button', { name: 'form.publicCropUnlinkAction' })).toBeInTheDocument();
    expect(screen.queryByText('form.publicCropLinkHint')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'form.publicCropLinkAction' })).not.toBeInTheDocument();
    expect(getNameInput()).toHaveValue('Tomate');
    expect(screen.getByLabelText(/form\.cropFamily/)).toHaveValue('Nachtschattengewächse');
    expect(screen.getByLabelText('form.growthDurationDays')).toHaveValue(80);
    expect(screen.getByText('form.publicCropLinkFilled')).toBeInTheDocument();
  });

  it('suggests only the matched species varieties in the optional first-variety field', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(getNameInput(), { target: { value: 'Toma' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Tomate' }));

    const firstVarietyInput = screen.getByRole('combobox', { name: /form\.firstVarietyLabel/ });
    await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith(
      { crop_species: 7 },
      expect.any(AbortSignal),
    ));
    fireEvent.change(firstVarietyInput, { target: { value: 'Mo' } });

    const listbox = await screen.findByRole('listbox');
    // The general entry carries an empty variety and must not become an option.
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Moneymaker']);
  });

  it('keeps the Kultur link when a free-text first variety name is entered', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(getNameInput(), { target: { value: 'Toma' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Tomate' }));

    await screen.findByText('form.publicCropLinkedHint');

    const firstVarietyInput = screen.getByRole('combobox', { name: /form\.firstVarietyLabel/ });
    fireEvent.change(firstVarietyInput, { target: { value: 'Custom' } });

    expect(screen.getByText('form.publicCropLinkedHint')).toBeInTheDocument();
    expect(screen.queryByText('form.firstVarietySourceHint')).not.toBeInTheDocument();
  });

  it('labels suggestions as coming from the public crop library while typing', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(getNameInput(), { target: { value: 'Toma' } });
    await screen.findByRole('option', { name: 'Tomate' });

    expect(screen.getByText('form.publicCropSuggestionsGroupLabel')).toBeInTheDocument();
  });

  it('links the first variety and shows the source hint when its suggestion is picked from the dropdown', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(getNameInput(), { target: { value: 'Toma' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Tomate' }));

    await screen.findByText('form.publicCropLinkedHint');

    const firstVarietyInput = screen.getByRole('combobox', { name: /form\.firstVarietyLabel/ });
    await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith(
      { crop_species: 7 },
      expect.any(AbortSignal),
    ));
    fireEvent.change(firstVarietyInput, { target: { value: 'Mo' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Moneymaker' }));

    await waitFor(() => expect(screen.getByText('form.firstVarietySourceHint')).toBeInTheDocument());
    expect(screen.queryByText('form.publicCropSourceHint')).not.toBeInTheDocument();
  });

  it('offers an explicit apply action instead of silently linking when typed first-variety text matches exactly', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(getNameInput(), { target: { value: 'Toma' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Tomate' }));

    const firstVarietyInput = screen.getByRole('combobox', { name: /form\.firstVarietyLabel/ });
    await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith(
      { crop_species: 7 },
      expect.any(AbortSignal),
    ));
    fireEvent.change(firstVarietyInput, { target: { value: 'Moneymaker' } });
    fireEvent.keyDown(firstVarietyInput, { key: 'Escape' });

    expect(screen.queryByText('form.firstVarietySourceHint')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('form.publicCropApplyAction'));

    await waitFor(() => expect(screen.getByText('form.firstVarietySourceHint')).toBeInTheDocument());
  });

  it('prefills the general crop fields when a Sorte is picked without ever explicitly linking the Name', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    // Exact-matching text alone (no dropdown pick) is enough to unlock the
    // Sorte suggestions, but it does not link crop_species on the draft.
    fireEvent.change(getNameInput(), { target: { value: 'Tomate' } });
    await screen.findByRole('option', { name: 'Tomate' });

    const firstVarietyInput = screen.getByRole('combobox', { name: /form\.firstVarietyLabel/ });
    await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith(
      { crop_species: 7 },
      expect.any(AbortSignal),
    ));
    fireEvent.change(firstVarietyInput, { target: { value: 'Mo' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Moneymaker' }));

    // The parent crop draft must also carry the species' general fields now,
    // not just the (separately saved) variety row.
    await waitFor(() => expect(screen.getByLabelText(/form\.cropFamily/)).toHaveValue('Nachtschattengewächse'));
  });

  it('prefills the general crop fields when a matched Sorte is applied via the explicit apply hint', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(getNameInput(), { target: { value: 'Tomate' } });
    await screen.findByRole('option', { name: 'Tomate' });

    const firstVarietyInput = screen.getByRole('combobox', { name: /form\.firstVarietyLabel/ });
    await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith(
      { crop_species: 7 },
      expect.any(AbortSignal),
    ));
    fireEvent.change(firstVarietyInput, { target: { value: 'Moneymaker' } });
    fireEvent.keyDown(firstVarietyInput, { key: 'Escape' });
    // The untouched Name field's own "apply" hint (offered because its typed
    // text also matches "Tomate" exactly) renders with the same label - the
    // Sorte field's hint is the one that appears last.
    const applyButtons = await screen.findAllByText('form.publicCropApplyAction');
    fireEvent.click(applyButtons[applyButtons.length - 1]);

    await waitFor(() => expect(screen.getByLabelText(/form\.cropFamily/)).toHaveValue('Nachtschattengewächse'));
  });

  it('keeps the first-variety field as plain free text for an unmatched crop name', async () => {
    mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

    render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(getNameInput(), { target: { value: 'Tomaten' } });
    await screen.findByRole('option', { name: 'Tomate' });

    // "Tomaten" never exactly matched the species, so no variety lookup ran.
    expect(publicCropListMock).not.toHaveBeenCalledWith(
      { crop_species: 7 },
      expect.any(AbortSignal),
    );
    const firstVarietyInput = screen.getByRole('combobox', { name: /form\.firstVarietyLabel/ });
    fireEvent.change(firstVarietyInput, { target: { value: 'Mo' } });
    expect(firstVarietyInput).toHaveValue('Mo');
    // The name field's own dropdown may still be open, so assert on the
    // variety suggestion specifically rather than on any listbox.
    expect(screen.queryByRole('option', { name: 'Moneymaker' })).not.toBeInTheDocument();
  });

  describe('linking a new Kultur to the crop library', () => {
    const typeMatchingName = async (value = 'Tomate') => {
      fireEvent.change(getNameInput(), { target: { value } });
      return screen.findByRole('button', { name: 'form.publicCropLinkAction' });
    };

    it('offers the link for typed text that matches an entry and links on the button', async () => {
      mockLibrary([GENERAL_TOMATO, MONEYMAKER]);
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);
      const linkButton = await typeMatchingName();

      expect(screen.getByText('form.publicCropLinkHint')).toBeInTheDocument();
      // Typed text alone never links or fills anything.
      expect(screen.getByLabelText(/form\.cropFamily/)).toHaveValue('');

      fireEvent.click(linkButton);

      await screen.findByText('form.publicCropLinkedHint');
      expect(screen.queryByText('form.publicCropLinkHint')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/form\.cropFamily/)).toHaveValue('Nachtschattengewächse');
      expect(screen.getByLabelText('form.growthDurationDays')).toHaveValue(80);
      expect(screen.getByText('form.publicCropLinkFilled')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'form.create' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({
        name: 'Tomate',
        link_public_crop: GENERAL_TOMATO.id,
        crop_species: 7,
        growth_duration_days: 80,
      }));
      expect(onSave.mock.calls[0][0].source_public_crop).toBeFalsy();
    });

    // Regression: a linked crop showed "Bibliothek aktualisieren" right after
    // creation because the sowing depth was rounded to whole centimetres.
    it('takes a fractional sowing depth from the entry unrounded', async () => {
      mockLibrary([{ ...GENERAL_TOMATO, sowing_depth_m: 0.015 } as PublicCrop, MONEYMAKER]);
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);
      fireEvent.click(await typeMatchingName());
      await screen.findByText('form.publicCropLinkedHint');
      fireEvent.click(screen.getByRole('button', { name: 'form.create' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0].sowing_depth_cm).toBe(1.5);
    });

    // Regression: the old "Werte übernehmen" button was offered for every
    // name match, but for a match it could not apply (no general entry of the
    // species, or a legacy entry without a species) clicking it did nothing.
    it('offers no link for a matched species without a general library entry', async () => {
      mockLibrary([MONEYMAKER]);

      render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
      fireEvent.change(getNameInput(), { target: { value: 'Tomate' } });
      await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith(
        { crop_species: 7 },
        expect.any(AbortSignal),
      ));

      expect(screen.queryByRole('button', { name: 'form.publicCropLinkAction' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'form.publicCropApplyAction' })).not.toBeInTheDocument();
    });

    it('offers no dead apply action for a legacy entry without a crop species', async () => {
      publicCropListMock.mockResolvedValue({
        data: { results: [{ ...GENERAL_TOMATO, id: 50, name: 'Topinambur', display_name: 'Topinambur', crop_species: null }] },
      });

      render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
      fireEvent.change(getNameInput(), { target: { value: 'Topinambur' } });
      await screen.findByRole('option', { name: 'Topinambur' });

      expect(screen.queryByRole('button', { name: 'form.publicCropLinkAction' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'form.publicCropApplyAction' })).not.toBeInTheDocument();
    });

    it('asks per field before overwriting values the user already entered', async () => {
      mockLibrary([GENERAL_TOMATO, MONEYMAKER]);
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);
      fireEvent.change(screen.getByLabelText('form.growthDurationDays'), { target: { value: '60' } });
      fireEvent.click(await typeMatchingName());

      const dialog = await screen.findByRole('dialog', { name: 'form.publicCropLinkAction' });
      expect(within(dialog).getByTestId('public-crop-sync-row-growth_duration_days')).toBeInTheDocument();
      // Empty fields are no conflict and are not listed.
      expect(within(dialog).queryByTestId('public-crop-sync-row-crop_family')).not.toBeInTheDocument();
      // Nothing changes before the user decides.
      expect(screen.getByLabelText('form.growthDurationDays')).toHaveValue(60);
      expect(screen.queryByText('form.publicCropLinkedHint')).not.toBeInTheDocument();

      // The link flow's preselection takes the library value; keep our own.
      fireEvent.click(within(dialog).getByRole('radio', { name: 'library.sync.chooseMine' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'form.publicCropLinkConfirm' }));

      await screen.findByText('form.publicCropLinkedHint');
      expect(screen.getByLabelText('form.growthDurationDays')).toHaveValue(60);
      expect(screen.getByLabelText(/form\.cropFamily/)).toHaveValue('Nachtschattengewächse');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'form.publicCropLinkAction' })).not.toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'form.create' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({
        link_public_crop: GENERAL_TOMATO.id,
        growth_duration_days: 60,
      }));
    });

    it('cancelling the per-field choice neither links nor changes anything', async () => {
      mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

      render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
      fireEvent.change(screen.getByLabelText('form.growthDurationDays'), { target: { value: '60' } });
      fireEvent.click(await typeMatchingName());

      const dialog = await screen.findByRole('dialog', { name: 'form.publicCropLinkAction' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'form.cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'form.publicCropLinkAction' })).not.toBeInTheDocument());
      expect(screen.getByLabelText('form.growthDurationDays')).toHaveValue(60);
      expect(screen.getByLabelText(/form\.cropFamily/)).toHaveValue('');
      expect(screen.getByRole('button', { name: 'form.publicCropLinkAction' })).toBeInTheDocument();
    });

    it('opens the per-field choice for a list pick that conflicts with entered values', async () => {
      mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

      render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
      fireEvent.change(screen.getByLabelText('form.growthDurationDays'), { target: { value: '60' } });
      fireEvent.change(getNameInput(), { target: { value: 'Toma' } });
      fireEvent.click(await screen.findByRole('option', { name: 'Tomate' }));

      const dialog = await screen.findByRole('dialog', { name: 'form.publicCropLinkAction' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'form.publicCropLinkConfirm' }));

      await screen.findByText('form.publicCropLinkedHint');
      expect(screen.getByLabelText('form.growthDurationDays')).toHaveValue(80);
    });

    it('"Verknüpfung aufheben" removes the link and keeps the form values', async () => {
      mockLibrary([GENERAL_TOMATO, MONEYMAKER]);
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(<CropForm formKind="crop" onSave={onSave} onCancel={() => {}} />);
      fireEvent.click(await typeMatchingName());
      fireEvent.click(await screen.findByRole('button', { name: 'form.publicCropUnlinkAction' }));

      expect(screen.queryByText('form.publicCropLinkedHint')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'form.publicCropLinkAction' })).toBeInTheDocument();
      expect(screen.getByLabelText(/form\.cropFamily/)).toHaveValue('Nachtschattengewächse');

      fireEvent.click(screen.getByRole('button', { name: 'form.create' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0].link_public_crop).toBeUndefined();
      expect(onSave.mock.calls[0][0].growth_duration_days).toBe(80);
    });

    it('drops the link when the name is edited after a list pick, keeping the values', async () => {
      mockLibrary([GENERAL_TOMATO, MONEYMAKER]);

      render(<CropForm formKind="crop" onSave={vi.fn()} onCancel={() => {}} />);
      fireEvent.change(getNameInput(), { target: { value: 'Toma' } });
      fireEvent.click(await screen.findByRole('option', { name: 'Tomate' }));
      await screen.findByText('form.publicCropLinkedHint');

      fireEvent.change(getNameInput(), { target: { value: 'Tomate gelb' } });

      expect(screen.queryByText('form.publicCropLinkedHint')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'form.publicCropLinkAction' })).not.toBeInTheDocument();
      expect(screen.getByLabelText(/form\.cropFamily/)).toHaveValue('Nachtschattengewächse');
      expect(screen.getByLabelText('form.growthDurationDays')).toHaveValue(80);

      // Back to text that matches an entry: the unlinked hint returns.
      fireEvent.change(getNameInput(), { target: { value: 'Tomate' } });
      expect(await screen.findByRole('button', { name: 'form.publicCropLinkAction' })).toBeInTheDocument();
      expect(screen.getByText('form.publicCropLinkHint')).toBeInTheDocument();
      expect(screen.queryByText('form.publicCropLinkedHint')).not.toBeInTheDocument();
    });
  });
});
