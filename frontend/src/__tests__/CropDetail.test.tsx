import { useState } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { CropDetail } from '../crops/CropDetail';
import type { Crop } from '../api/api';
import translations from '@/test-utils/translations';
import i18n from '../i18n/config';
import { CROP_FILTERS_STORAGE_KEY } from '../crops/cropDetailFormatters';

describe('CropDetail Component', () => {
  const renderCropDetail = (ui: Parameters<typeof render>[0]) =>
    render(ui, { wrapper: MemoryRouter });

  function mockPhoneLandscapeViewport(): void {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('orientation: landscape')
          || (query.includes('min-width:600px') && query.includes('max-width:899.95px'))
          || (query.includes('min-width:600px') && query.includes('max-width:1199.95px')),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  beforeEach(async () => {
    window.sessionStorage.clear();
    await i18n.changeLanguage('de');
  });

  const mockCrops: Crop[] = [
    {
      id: 1,
      name: 'Tomato',
      variety: 'Cherry',

      growth_duration_days: 56,
      harvest_duration_days: 28,
      harvest_method: 'per_plant',
      notes: 'Frisch und süß.',
    },
    {
      id: 2,
      name: 'Lettuce',

      growth_duration_days: 42,
      harvest_duration_days: 14,
    },
    {
      id: 3,
      name: 'Asparagus',

      growth_duration_days: 730,
      harvest_duration_days: 56,
    },
  ];

  function KeyboardNavigationHarness({
    initialSelectedId = 1,
  }: {
    initialSelectedId?: number;
  }) {
    const [selectedCropId, setSelectedCropId] = useState<number | undefined>(initialSelectedId);

    return (
      <CropDetail
        crops={mockCrops}
        selectedCropId={selectedCropId}
        onCropSelect={(crop) => setSelectedCropId(crop?.id)}
      />
    );
  }

  it('renders search field', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        onCropSelect={mockOnSelect}
      />
    );
    
    expect(screen.getByLabelText(translations.crops.searchPlaceholder)).toBeInTheDocument();
  });

  it('displays empty state when no crop is selected', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        onCropSelect={mockOnSelect}
      />
    );
    
    expect(screen.getByText(translations.crops.selectPrompt)).toBeInTheDocument();
  });

  it('does not auto-select a fallback crop when the selection is momentarily missing from the list (regression: selection flip-flop after creating a crop)', () => {
    const onCropSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={999}
        onCropSelect={onCropSelect}
      />
    );

    expect(onCropSelect).not.toHaveBeenCalled();
  });

  it('shows loading state without empty-state flicker', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={[]}
        isLoading
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getByText('Kulturen werden geladen…')).toBeInTheDocument();
    expect(screen.queryByText(translations.crops.emptySearch.title)).not.toBeInTheDocument();
  });

  it('shows onboarding empty-state when no crops exist', () => {
    renderCropDetail(
      <CropDetail
        crops={[]}
        onCropSelect={vi.fn()}
        onCreateCrop={vi.fn()}
        onOpenPublicLibrary={vi.fn()}
      />
    );

    expect(screen.getByText('Noch keine Kulturen vorhanden')).toBeInTheDocument();
    expect(screen.getByTestId('InfoOutlinedIcon')).toBeInTheDocument();
    expect(screen.queryByLabelText(translations.crops.searchPlaceholder)).not.toBeInTheDocument();
    expect(screen.queryByText('Keine Kulturen gefunden')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suche und Filter zurücksetzen' })).not.toBeInTheDocument();
  });

  it('offers a file import in the onboarding empty-state', () => {
    const onImportFile = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={[]}
        onCropSelect={vi.fn()}
        onCreateCrop={vi.fn()}
        onOpenPublicLibrary={vi.fn()}
        onImportFile={onImportFile}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Aus Datei importieren' }));

    expect(onImportFile).toHaveBeenCalled();
  });

  it('shows filter empty-state when crops exist but filters have no matches', () => {
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        onCropSelect={vi.fn()}
      />
    );

    const searchInput = screen.getByLabelText(translations.crops.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'ZZZ-kein-treffer' } });

    expect(screen.getByText('Keine Kulturen gefunden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suche und Filter zurücksetzen' })).toBeInTheDocument();
  });

  it('filters by group, a Kultur staying visible for its matching Sorte', () => {
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, JSON.stringify({ selectedTagFilter: 'Blumen' }));
    const crops = [
      { id: 21, name: 'Kamille', variety: '', tags: ['Kräuter'] },
      { id: 22, name: 'Kamille', variety: 'Zierkamille', tags: ['Blumen'], general_crop: 21 },
      { id: 23, name: 'Salbei', variety: '', tags: ['Kräuter'] },
      { id: 24, name: 'Ringelblume', variety: '', tags: ['blumen'] },
    ] as Crop[];

    renderCropDetail(<CropDetail crops={crops} onCropSelect={vi.fn()} />);

    // Kamille's own group is "Kräuter"; it stays listed because Zierkamille matches.
    expect(screen.getByText('Kamille')).toBeInTheDocument();
    expect(screen.getByText('Ringelblume')).toBeInTheDocument();
    expect(screen.queryByText('Salbei')).not.toBeInTheDocument();
  });

  it('keeps variety matches in the embedded crop search list', async () => {
    const user = userEvent.setup();

    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        onCropSelect={vi.fn()}
      />,
    );

    const searchInput = screen.getByLabelText(translations.crops.searchPlaceholder);
    await user.click(searchInput);
    await user.type(searchInput, 'Cherry');

    expect(screen.queryByText('Keine Kulturen gefunden')).not.toBeInTheDocument();
    const cropList = screen.getByRole('listbox', { name: translations.crops.title });
    // The hit shows up in the list itself — the Kultur group opens and carries
    // its Sorte — instead of in an overlay floating above it.
    expect(within(cropList).getByRole('option', { name: 'Tomato' })).toBeInTheDocument();
    expect(within(cropList).getByRole('option', { name: 'Cherry' })).toBeInTheDocument();
  });

  it('keeps the Kultur selectable when the search matched only its Sorte', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const crops: Crop[] = [
      { id: 10, name: 'Pfefferoni', variety: '', crop_species: 30, growth_duration_days: 60 },
      { id: 11, name: 'Pfefferoni', variety: 'Milder Spiral', crop_species: 30 },
      { id: 12, name: 'Pfefferoni', variety: 'Scharfer Spiral', crop_species: 30 },
    ];

    renderCropDetail(
      <CropDetail
        crops={crops}
        onCropSelect={onSelect}
      />,
    );

    const searchInput = screen.getByLabelText(translations.crops.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'Milder' } });

    const cropList = screen.getByRole('listbox', { name: translations.crops.title });
    await user.click(within(cropList).getByRole('option', { name: 'Pfefferoni' }));

    // The Kultur row must select the Kultur itself, not fall back to the one
    // Sorte the search left in the tree.
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }));
  });

  it('collapses a crop group without changing the selected detail view', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={2}
        onCropSelect={onSelect}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Lettuce' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cherry' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Kultur aufklappen' }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2, name: 'Lettuce' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cherry' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Kultur zuklappen' }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2, name: 'Lettuce' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cherry' })).not.toBeInTheDocument();
  });

  it('expands a species row on double click while keeping single click as selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={2}
        onCropSelect={onSelect}
      />,
    );

    expect(screen.queryByRole('option', { name: 'Cherry' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'Tomato' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('option', { name: 'Cherry' })).not.toBeInTheDocument();

    await user.dblClick(screen.getByRole('option', { name: 'Tomato' }));

    expect(onSelect).toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Cherry' })).toBeInTheDocument();
  });

  it('selects the next and previous visible crop with arrow keys and keeps focus in the list', async () => {
    const user = userEvent.setup();
    renderCropDetail(<KeyboardNavigationHarness />);

    // Rows in view: the "Tomato" group header, its "Cherry" Sorte, then the
    // Lettuce and Asparagus headers.
    screen.getByRole('option', { name: 'Cherry' }).focus();

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('heading', { level: 2, name: 'Lettuce' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Lettuce/ })).toHaveFocus();
    });

    await user.keyboard('{ArrowUp}');

    expect(screen.getByRole('heading', { level: 2, name: 'Tomato' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Cherry' })).toHaveFocus();
    });
  });

  it('stops on a Kultur group header without selecting it', async () => {
    const user = userEvent.setup();
    renderCropDetail(<KeyboardNavigationHarness initialSelectedId={2} />);

    screen.getByRole('option', { name: /Lettuce/ }).focus();

    // "Tomato" has no varietyless entry of its own, so the header is a focus
    // stop that leaves the selected Kultur alone.
    await user.keyboard('{ArrowUp}');

    expect(screen.getByRole('heading', { level: 2, name: 'Lettuce' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tomato' })).toHaveFocus();
    });
  });

  it('jumps to the first and last row with Home and End', async () => {
    const user = userEvent.setup();
    renderCropDetail(<KeyboardNavigationHarness initialSelectedId={2} />);

    screen.getByRole('option', { name: /Lettuce/ }).focus();

    await user.keyboard('{End}');
    expect(screen.getByRole('heading', { level: 2, name: 'Asparagus' })).toBeInTheDocument();

    // Home lands on the first row — the collapsed "Tomato" group header, which
    // has no varietyless entry of its own — so only the focus moves.
    await user.keyboard('{Home}');
    expect(screen.getByRole('heading', { level: 2, name: 'Asparagus' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tomato' })).toHaveFocus();
    });
  });

  it('does not wrap around at the beginning or end of the crop list', async () => {
    const user = userEvent.setup();
    renderCropDetail(<KeyboardNavigationHarness />);

    screen.getByRole('option', { name: /Tomato/ }).focus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('heading', { level: 2, name: 'Tomato' })).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(screen.getByRole('heading', { level: 2, name: 'Asparagus' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('heading', { level: 2, name: 'Asparagus' })).toBeInTheDocument();
  });

  it('navigates only through crops visible after search filtering', async () => {
    const user = userEvent.setup();
    renderCropDetail(<KeyboardNavigationHarness />);

    const searchInput = screen.getByLabelText(translations.crops.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 't' } });

    const cropList = screen.getByRole('listbox', { name: translations.crops.title });
    within(cropList).getByRole('option', { name: 'Cherry' }).focus();

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('heading', { level: 2, name: 'Lettuce' })).toBeInTheDocument();
    expect(within(cropList).queryByRole('option', { name: /Asparagus/ })).not.toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('heading', { level: 2, name: 'Lettuce' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('heading', { level: 2, name: 'Lettuce' })).toBeInTheDocument();
  });

  describe('live filtered crop search list', () => {
    const searchCrops: Crop[] = [
      { id: 100, name: 'Karotte', variety: '', crop_species: 1 },
      { id: 101, name: 'Karotte', variety: 'Nantaise', crop_species: 1 },
      { id: 102, name: 'Karotte', variety: 'Rodelika', crop_species: 1 },
      { id: 200, name: 'Kohlrabi', variety: '', crop_species: 2 },
      { id: 201, name: 'Kohlrabi', variety: 'Superschmelz', crop_species: 2 },
      { id: 300, name: 'Zwiebel', variety: '', crop_species: 3 },
    ];

    const renderSearchList = (onCropSelect = vi.fn(), selectedCropId?: number) => {
      renderCropDetail(
        <CropDetail
          crops={searchCrops}
          selectedCropId={selectedCropId}
          onCropSelect={onCropSelect}
        />,
      );
      return {
        onCropSelect,
        searchInput: screen.getByLabelText(translations.crops.searchPlaceholder),
        list: screen.getByRole('listbox', { name: translations.crops.title }),
      };
    };

    it('shows every Kultur as a collapsed group header with its count while the search field is empty', () => {
      const { list } = renderSearchList();

      expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
        'Karotte(2)',
        'Kohlrabi(1)',
        'Zwiebel(0)',
      ]);
    });

    it('filters from the very first character', () => {
      const { list, searchInput } = renderSearchList();

      fireEvent.change(searchInput, { target: { value: 'z' } });

      expect(within(list).queryByRole('option', { name: 'Karotte' })).not.toBeInTheDocument();
      expect(within(list).getByRole('option', { name: 'Zwiebel' })).toBeInTheDocument();
    });

    it('opens a hit group with all of its Sorten, not only the matching one', () => {
      const { list, searchInput } = renderSearchList();

      fireEvent.change(searchInput, { target: { value: 'rodelika' } });

      expect(within(list).getByRole('option', { name: 'Karotte' })).toBeInTheDocument();
      expect(within(list).getByRole('option', { name: 'Rodelika' })).toBeInTheDocument();
      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();
      expect(within(list).queryByRole('option', { name: 'Kohlrabi' })).not.toBeInTheDocument();
    });

    it('marks the matched part of the Kultur and Sorten names', () => {
      const { list, searchInput } = renderSearchList();

      fireEvent.change(searchInput, { target: { value: 'ka' } });

      const marks = within(list).getAllByText('Ka', { selector: 'mark' });
      expect(marks.length).toBeGreaterThan(0);
      expect(within(within(list).getByRole('option', { name: 'Karotte' })).getByText('Ka', { selector: 'mark' })).toBeInTheDocument();
      expect(within(within(list).getByRole('option', { name: 'Rodelika' })).getByText('ka', { selector: 'mark' })).toBeInTheDocument();
    });

    it('keeps a manually collapsed group closed while it still matches', async () => {
      const user = userEvent.setup();
      const { list, searchInput } = renderSearchList();

      fireEvent.change(searchInput, { target: { value: 'k' } });
      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();

      const karotteRow = within(list).getByRole('option', { name: 'Karotte' });
      await user.click(within(karotteRow).getByRole('button', { name: 'Kultur zuklappen' }));
      expect(within(list).queryByRole('option', { name: 'Nantaise' })).not.toBeInTheDocument();

      // "Karotte" is still a hit for "ka", so typing on must not re-open it.
      fireEvent.change(searchInput, { target: { value: 'ka' } });

      expect(within(list).getByRole('option', { name: 'Karotte' })).toBeInTheDocument();
      expect(within(list).queryByRole('option', { name: 'Nantaise' })).not.toBeInTheDocument();
    });

    it('re-opens a group that dropped out of the results and matches again', async () => {
      const user = userEvent.setup();
      const { list, searchInput } = renderSearchList();

      fireEvent.change(searchInput, { target: { value: 'ka' } });
      const karotteRow = within(list).getByRole('option', { name: 'Karotte' });
      await user.click(within(karotteRow).getByRole('button', { name: 'Kultur zuklappen' }));
      expect(within(list).queryByRole('option', { name: 'Nantaise' })).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'zwie' } });
      expect(within(list).queryByRole('option', { name: 'Karotte' })).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'ka' } });

      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();
    });

    it('collapses the groups the search opened once the field is cleared', () => {
      const { list, searchInput } = renderSearchList();

      fireEvent.change(searchInput, { target: { value: 'ka' } });
      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: '' } });

      expect(within(list).queryByRole('option', { name: 'Nantaise' })).not.toBeInTheDocument();
      expect(within(list).getByRole('option', { name: 'Karotte' })).toBeInTheDocument();
    });

    it('leaves a group the user expanded before searching open when the search is cleared', async () => {
      const user = userEvent.setup();
      const { list, searchInput } = renderSearchList();

      const karotteRow = within(list).getByRole('option', { name: 'Karotte' });
      await user.click(within(karotteRow).getByRole('button', { name: 'Kultur aufklappen' }));
      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'ka' } });
      fireEvent.change(searchInput, { target: { value: '' } });

      // The search never opened this group, so clearing it must not close it.
      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();
    });

    it('keeps the selected Sorte visible when the search is cleared', () => {
      const { list, searchInput } = renderSearchList(vi.fn(), 101);

      fireEvent.change(searchInput, { target: { value: 'nantaise' } });
      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: '' } });

      // Collapsing the group here would drop the selected row out of the list
      // while the detail view still shows it.
      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();
    });

    it('selects a Sorte with Enter and leaves the filtered list standing', async () => {
      const user = userEvent.setup();
      const { list, onCropSelect, searchInput } = renderSearchList();

      fireEvent.change(searchInput, { target: { value: 'ka' } });
      within(list).getByRole('option', { name: 'Nantaise' }).focus();
      await user.keyboard('{Enter}');

      expect(onCropSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 101 }));
      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();
      expect(within(list).getByRole('option', { name: 'Rodelika' })).toBeInTheDocument();
      expect(searchInput).toHaveValue('ka');
    });

    it('toggles a group with Enter on its header without changing the selection', async () => {
      const user = userEvent.setup();
      const { list, onCropSelect } = renderSearchList();

      const karotteHeader = within(list).getByRole('option', { name: 'Karotte' });
      karotteHeader.focus();
      expect(karotteHeader).toHaveAttribute('aria-expanded', 'false');

      await user.keyboard('{Enter}');

      expect(onCropSelect).not.toHaveBeenCalled();
      expect(within(list).getByRole('option', { name: 'Nantaise' })).toBeInTheDocument();
      expect(within(list).getByRole('option', { name: 'Karotte' })).toHaveAttribute('aria-expanded', 'true');

      await user.keyboard('{Enter}');

      expect(onCropSelect).not.toHaveBeenCalled();
      expect(within(list).queryByRole('option', { name: 'Nantaise' })).not.toBeInTheDocument();
    });

    it('keeps Enter on a Kultur without Sorten as a selection', async () => {
      const user = userEvent.setup();
      const { list, onCropSelect } = renderSearchList();

      within(list).getByRole('option', { name: 'Zwiebel' }).focus();
      await user.keyboard('{Enter}');

      expect(onCropSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 300 }));
    });

    it('clears the search from the field', async () => {
      const user = userEvent.setup();
      const { list, searchInput } = renderSearchList();

      expect(screen.queryByRole('button', { name: translations.crops.clearSearch })).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'zwie' } });
      await user.click(screen.getByRole('button', { name: translations.crops.clearSearch }));

      expect(searchInput).toHaveValue('');
      expect(within(list).getByRole('option', { name: 'Karotte' })).toBeInTheDocument();
      // The button unmounts as it clears, so focus has to land back on the field.
      expect(searchInput).toHaveFocus();
    });

    it('shows the no-results text when nothing matches', () => {
      const { searchInput } = renderSearchList();

      fireEvent.change(searchInput, { target: { value: 'xyz' } });

      expect(screen.getByText(translations.crops.noOptionsEnhanced)).toBeInTheDocument();
      // The message replaces the listbox rather than sitting inside it as a
      // role-less row assistive tech would prune.
      expect(screen.queryByRole('listbox', { name: translations.crops.title })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });
  });

  it('does not intercept arrow keys while the search field is focused', async () => {
    const user = userEvent.setup();
    renderCropDetail(<KeyboardNavigationHarness />);

    const searchInput = screen.getByLabelText(translations.crops.searchPlaceholder);
    searchInput.focus();

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('heading', { level: 2, name: 'Tomato' })).toBeInTheDocument();
    expect(searchInput).toHaveFocus();
  });

  it('displays crop details when crop is selected', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={mockOnSelect}
      />
    );
    
    expect(screen.getByRole('heading', { level: 2, name: 'Tomato' })).toBeInTheDocument();
    expect(screen.getAllByText('Cherry').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 3, name: 'Lieferant' })).toBeInTheDocument();
  });

  it('displays the localized name for imported crops linked to translated species', () => {
    renderCropDetail(
      <CropDetail
        crops={[{
          id: 10,
          name: 'Ackerbohne',
          crop_display_name: 'Broad bean',
          crop_display_language_code: 'en',
          crop_species_translations: {
            de: 'Ackerbohne',
            en: 'Broad bean',
          },
          variety: 'Hangdown',
          origin_type: 'imported',
        }]}
        selectedCropId={10}
        onCropSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Broad bean' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Broad bean/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Ackerbohne' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Hangdown').length).toBeGreaterThan(0);
    expect(screen.getByText('Importiert')).toBeInTheDocument();
  });

  it('renders detail sections in the expected order', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={mockOnSelect}
      />
    );

    const sectionTitles = screen.getAllByRole('heading', { level: 6 }).map((node) => node.textContent?.trim());
    expect(sectionTitles).toEqual([
      'Fruchtfolge-Eigenschaften',
      'Mischkultur',
      'Zeitplanung',
      'Abstände',
      'Saatgut',
      'Ernte',
      'Notizen',
    ]);
  });

  it('shows the crop rotation break as a plain section without a nested container', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={mockOnSelect}
      />
    );

    const heading = screen.getByRole('heading', { level: 6, name: translations.crops.detail.sections.cropRotation });
    expect(screen.getByText(translations.crops.form.rotationBreakYears)).toBeInTheDocument();
    expect(screen.getAllByText(translations.crops.noData).length).toBeGreaterThan(0);
    // Structurally identical to the other sections (heading + grid, no
    // separate bordered/backgrounded wrapper), unlike the old "Allgemeine
    // Informationen" container this section replaced.
    expect(heading.closest('div')).not.toHaveStyle({ border: '1px solid #e5e7eb' });
  });

  it('shows the configured rotation break in years, and the renamed nutrient demand labels', () => {
    const mockOnSelect = vi.fn();
    const cropsWithRotationBreak: Crop[] = [
      { ...mockCrops[0], nutrient_demand: 'high', rotation_break_years: 4 },
    ];
    renderCropDetail(
      <CropDetail
        crops={cropsWithRotationBreak}
        selectedCropId={1}
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getByText(`4 ${translations.crops.detail.units.years}`)).toBeInTheDocument();
    expect(screen.getByText('Starkzehrer')).toBeInTheDocument();
  });

  it('renders crop detail labels and static values in English', async () => {
    await i18n.changeLanguage('en');
    const crops: Crop[] = [
      {
        id: 31,
        name: 'Carrot',
        crop_family: 'Apiaceae',
        nutrient_demand: 'medium',
        cultivation_types: ['pre_cultivation', 'direct_sowing'],
        growth_duration_days: 70,
        harvest_duration_days: 21,
        distance_within_row_cm: 5,
        row_spacing_cm: 30,
        sowing_depth_cm: 1.5,
        seed_rate_direct_value: 0.014,
        seed_rate_direct_unit: 'seeds_per_lfm',
        sowing_calculation_safety_percent_direct: 5,
        seed_rate_pre_cultivation_value: 1.357,
        seed_rate_pre_cultivation_unit: 'seeds_per_plant',
        sowing_calculation_safety_percent_pre_cultivation: 10,
        thousand_kernel_weight_g: 1.3,
        harvest_method: 'per_sqm',
        expected_yield: 4.5,
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={crops}
        selectedCropId={31}
        onCropSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { level: 6, name: 'Crop Rotation Properties' })).toBeInTheDocument();
    expect(screen.getByText('Crop family')).toBeInTheDocument();
    expect(screen.getByText('Nutrient demand')).toBeInTheDocument();
    expect(screen.getByText('Medium feeder')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 6, name: 'Spacing' })).toBeInTheDocument();
    expect(screen.getByText('In-row spacing')).toBeInTheDocument();
    const seedHeading = screen.getByRole('heading', { level: 6, name: 'Seed' });
    expect(seedHeading).toBeInTheDocument();
    const cultivationTypeLabel = screen.getByText('Cultivation type');
    expect(cultivationTypeLabel).toBeInTheDocument();
    expect(screen.getByText('Transplanting, Direct sowing')).toBeInTheDocument();
    const seedRateByCultivationLabel = screen.getByText('Seed quantity by cultivation type');
    expect(seedRateByCultivationLabel).toBeInTheDocument();
    // Cultivation type now lives in the Seed section, directly above the
    // per-method seed-rate table it used to be disconnected from.
    expect(seedHeading.compareDocumentPosition(cultivationTypeLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cultivationTypeLabel.compareDocumentPosition(seedRateByCultivationLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('seeds / plant')).toBeInTheDocument();
    expect(screen.getByText('seeds / running m')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 6, name: 'Yield' })).toBeInTheDocument();
    expect(screen.getByText('Expected yield')).toBeInTheDocument();
  });

  it('renders supplier seed data once inside the seed section', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={mockOnSelect}
      />
    );

    const seedHeading = screen.getByRole('heading', { level: 6, name: 'Saatgut' });
    const harvestHeading = screen.getByRole('heading', { level: 6, name: 'Ernte' });
    const supplierSubheading = screen.getByRole('heading', { level: 3, name: 'Lieferant' });

    expect(screen.getAllByRole('heading', { level: 3, name: 'Lieferant' })).toHaveLength(1);
    expect(seedHeading.compareDocumentPosition(supplierSubheading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(supplierSubheading.compareDocumentPosition(harvestHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('displays harvest information correctly', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={mockOnSelect}
      />
    );
    
    expect(screen.getByText(/56\s+Tage/)).toBeInTheDocument();
    expect(screen.getByText(/28\s+Tage/)).toBeInTheDocument();
    expect(screen.getByText('Ertragseinheit')).toBeInTheDocument();
    expect(screen.getByText('Pro Pflanze')).toBeInTheDocument();
  });


  it('displays sowing depth with one decimal place', () => {
    const mockOnSelect = vi.fn();
    const cropsWithDepth: Crop[] = [
      {
        id: 10,
        name: 'Karotte',
        variety: 'Nantaise',
        sowing_depth_cm: 2,
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={cropsWithDepth}
        selectedCropId={10}
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getByText('2,0 cm')).toBeInTheDocument();
  });

  it('displays notes when available', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={mockOnSelect}
      />
    );
    
    const notesHeading = screen.getByRole('heading', { level: 6, name: 'Notizen' });
    const notesContent = screen.getByText('Frisch und süß.');

    expect(notesContent).toBeInTheDocument();
    expect(notesHeading.nextElementSibling).toContainElement(notesContent);
    expect(notesHeading).not.toContainElement(notesContent);
  });

  it('shows the language fallback chip in the notes block for imported public notes', () => {
    renderCropDetail(
      <CropDetail
        crops={[{
          id: 10,
          name: 'Tomate',
          notes: 'A robust variety.',
          description_language_code: 'en',
          origin_type: 'imported',
        }]}
        selectedCropId={10}
        onCropSelect={vi.fn()}
      />
    );

    const notesSection = screen
      .getByRole('heading', { level: 6, name: 'Notizen' })
      .closest('section');

    expect(notesSection).not.toBeNull();
    expect(
      within(notesSection as HTMLElement).getByText('Nur auf Englisch verfügbar'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('crop-detail-header')).queryByText('Nur auf Englisch verfügbar'),
    ).not.toBeInTheDocument();
  });

  it('does not show a language chip for notes in the current UI language', () => {
    renderCropDetail(
      <CropDetail
        crops={[{
          id: 11,
          name: 'Tomate',
          notes: 'Robuste Sorte.',
          description_language_code: 'de',
          origin_type: 'imported',
        }]}
        selectedCropId={11}
        onCropSelect={vi.fn()}
      />
    );

    expect(screen.getByText('Robuste Sorte.')).toBeInTheDocument();
    expect(screen.queryByText(/Nur auf .* verfügbar/)).not.toBeInTheDocument();
  });

  it('does not show a language chip when notes are empty', () => {
    renderCropDetail(
      <CropDetail
        crops={[{
          id: 12,
          name: 'Tomate',
          notes: '',
          description_language_code: 'en',
          origin_type: 'imported',
        }]}
        selectedCropId={12}
        onCropSelect={vi.fn()}
      />
    );

    expect(screen.queryByText(/Nur auf .* verfügbar/)).not.toBeInTheDocument();
  });

  it('renders supplier homepage as clickable link', () => {
    const mockOnSelect = vi.fn();
    const cropsWithSupplier: Crop[] = [
      {
        id: 12,
        name: 'Salat',
        supplier_data: [{
          supplier: {
            id: 9,
            name: 'ReinSaat',
            homepage_url: 'https://www.reinsaat.at',
            allowed_domains: ['reinsaat.at'],
          },
          supplier_product_url: 'https://www.reinsaat.at',
        }],
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={cropsWithSupplier}
        selectedCropId={12}
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getByRole('link', { name: 'https://www.reinsaat.at' })).toHaveAttribute('href', 'https://www.reinsaat.at');
  });

  it('renders simplified single-supplier seed details without helper text', () => {
    const mockOnSelect = vi.fn();
    const cropsWithSupplierPackages: Crop[] = [
      {
        id: 13,
        name: 'Rote Bete',
        thousand_kernel_weight_g: 4,
        supplier: { id: 9, name: 'ReinSaat', allowed_domains: [] },
        supplier_data: [
          {
            supplier: { id: 9, name: 'ReinSaat', allowed_domains: [] },
            packaging_sizes: [{ size_value: 5, size_unit: 'g' }, { size_value: 10, size_unit: 'g' }, { size_value: 25, size_unit: 'g' }],
          },
        ],
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={cropsWithSupplierPackages}
        selectedCropId={13}
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Lieferant' })).toBeInTheDocument();
    expect(screen.queryByText('Die folgenden Angaben gelten nur für den ausgewählten Lieferanten dieser Kultur.')).not.toBeInTheDocument();
    expect(screen.getByText('ReinSaat')).toBeInTheDocument();
    expect(screen.getByText('5 g, 10 g, 25 g')).toBeInTheDocument();
    expect(screen.getByText('4 g')).toBeInTheDocument();
  });

  it('formats crop TKG values in German number style', () => {
    const mockOnSelect = vi.fn();
    const cropsWithDecimalTkg: Crop[] = [
      {
        id: 17,
        name: 'Dill',
        thousand_kernel_weight_g: 3.9,
        supplier_data: [
          {
            supplier_name: 'ReinSaat',
            packaging_sizes: [{ size_value: 25, size_unit: 'g' }],
          },
        ],
      },
      {
        id: 18,
        name: 'Koriander',
        thousand_kernel_weight_g: 3.85,
        supplier_data: [
          {
            supplier_name: 'ReinSaat',
            packaging_sizes: [{ size_value: 25, size_unit: 'g' }],
          },
        ],
      },
    ];

    const { rerender } = renderCropDetail(
      <CropDetail
        crops={cropsWithDecimalTkg}
        selectedCropId={17}
        onCropSelect={mockOnSelect}
      />
    );
    expect(screen.getByText('3,9 g')).toBeInTheDocument();

    rerender(
      <CropDetail
        crops={cropsWithDecimalTkg}
        selectedCropId={18}
        onCropSelect={mockOnSelect}
      />
    );
    expect(screen.getByText('3,85 g')).toBeInTheDocument();
  });

  it('renders no-data state when supplier package sizes are empty or invalid', () => {
    const mockOnSelect = vi.fn();
    const cropsWithEmptySupplierPackages: Crop[] = [
      {
        id: 14,
        name: 'Pastinake',
        supplier_data: [
          {
            supplier_name: 'ReinSaat',
            packaging_sizes: [
              { size_value: 0, size_unit: 'g' },
              { size_value: Number.NaN, size_unit: 'g' },
              { size_unit: 'g' } as unknown as { size_value: number; size_unit: 'g' | 'seeds' },
            ],
          },
        ],
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={cropsWithEmptySupplierPackages}
        selectedCropId={14}
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getAllByText(translations.crops.noData).length).toBeGreaterThan(0);
  });

  it('renders supplier-specific heading and helper text when multiple suppliers exist', () => {
    const mockOnSelect = vi.fn();
    const cropsWithMultipleSuppliers: Crop[] = [
      {
        id: 16,
        name: 'Fenchel',
        supplier_data: [
          {
            supplier: { id: 2, name: 'Alpha Seeds', allowed_domains: [] },
            packaging_sizes: [{ size_value: 5, size_unit: 'g' }],
          },
          {
            supplier: { id: 3, name: 'Beta Seeds', allowed_domains: [] },
            packaging_sizes: [{ size_value: 10, size_unit: 'g' }],
          },
        ],
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={cropsWithMultipleSuppliers}
        selectedCropId={16}
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Kulturspezifische Lieferantendaten' })).toBeInTheDocument();
    expect(screen.getByText('Die folgenden Angaben gelten nur für den ausgewählten Lieferanten dieser Kultur.')).toBeInTheDocument();
    expect(screen.getByText('Alpha Seeds')).toBeInTheDocument();
    expect(screen.getByText('Beta Seeds')).toBeInTheDocument();
    expect(screen.getByText('5 g')).toBeInTheDocument();
    expect(screen.getByText('10 g')).toBeInTheDocument();
  });

  it('uses crop-level TKG and supplier package data in seed section', () => {
    const mockOnSelect = vi.fn();
    const cropsWithLegacyValues: Crop[] = [
      {
        id: 15,
        name: 'Karotte',
        thousand_kernel_weight_g: 99,
        seed_packages: [{ size_value: 999, size_unit: 'g' }],
        supplier_data: [
          {
            supplier_name: 'ReinSaat',
            packaging_sizes: [{ size_value: 25, size_unit: 'g' }],
          },
        ],
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={cropsWithLegacyValues}
        selectedCropId={15}
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getByText('25 g')).toBeInTheDocument();
    expect(screen.getAllByText('1000-Korn-Gewicht (g)')).toHaveLength(1);
    expect(screen.getByText('99 g')).toBeInTheDocument();
    expect(screen.queryByText('999 g')).not.toBeInTheDocument();
  });

  it('keeps selected crop visible even when active search filter does not match', () => {
    const mockOnSelect = vi.fn();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={mockOnSelect}
      />
    );

    const searchInput = screen.getByLabelText(translations.crops.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'zzzz-no-match' } });

    expect(screen.getByRole('heading', { level: 2, name: 'Tomato' })).toBeInTheDocument();
    expect(screen.getByText('Cherry')).toBeInTheDocument();
  });

  it('shows cultivation types as text and per-method seed-rate table', () => {
    const mockOnSelect = vi.fn();
    const crops: Crop[] = [
      {
        id: 11,
        name: 'Möhre',
        cultivation_types: ['pre_cultivation', 'direct_sowing'],
        seed_rate_direct_value: 0.014,
        seed_rate_direct_unit: 'seeds_per_lfm',
        sowing_calculation_safety_percent_direct: 5,
        seed_rate_pre_cultivation_value: 1.357,
        seed_rate_pre_cultivation_unit: 'seeds_per_plant',
        sowing_calculation_safety_percent_pre_cultivation: 10,
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={crops}
        selectedCropId={11}
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getByText('Pflanzung, Direktsaat')).toBeInTheDocument();
    expect(screen.getByText('Saatgutmenge nach Anbauart')).toBeInTheDocument();
    expect(screen.getByText('1,357')).toBeInTheDocument();
    expect(screen.getByText('0,014')).toBeInTheDocument();
    expect(screen.getByText('Korn / Pflanze')).toBeInTheDocument();
    expect(screen.getByText('Korn / lfm')).toBeInTheDocument();
    expect(screen.getByText('10 %')).toBeInTheDocument();
    expect(screen.getByText('5 %')).toBeInTheDocument();
  });

  it('shows simplified seed view for a single active cultivation method', () => {
    const mockOnSelect = vi.fn();
    const crops: Crop[] = [
      {
        id: 21,
        name: 'Spinat',
        cultivation_types: ['pre_cultivation'],
        seed_rate_direct_value: 20,
        seed_rate_direct_unit: 'seeds_per_lfm',
        sowing_calculation_safety_percent_direct: 9,
        seed_rate_pre_cultivation_value: 0.125,
        seed_rate_pre_cultivation_unit: 'g_per_m2',
        sowing_calculation_safety_percent_pre_cultivation: 11,
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={crops}
        selectedCropId={21}
        onCropSelect={mockOnSelect}
      />
    );

    expect(screen.getAllByText('Pflanzung').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Direktsaat')).toHaveLength(0);
    expect(screen.queryByText('Saatgutmenge nach Anbauart')).not.toBeInTheDocument();
    expect(screen.queryByText('Methode')).not.toBeInTheDocument();
    expect(screen.getByText('Menge')).toBeInTheDocument();
    expect(screen.getByText('0,125 g / m²')).toBeInTheDocument();
    expect(screen.getByText('11 %')).toBeInTheDocument();
    expect(screen.queryByText('9 %')).not.toBeInTheDocument();
  });

  it('marks variety values as from the crop or own values', () => {
    const crops: Crop[] = [
      {
        id: 31,
        name: 'Tomate',
        variety: '',
        crop_species: 7,
        crop_family: 'Nachtschattengewächse',
        nutrient_demand: 'high',
        cultivation_types: ['pre_cultivation'],
        growth_duration_days: 78,
        harvest_duration_days: 56,
        row_spacing_cm: 80,
        distance_within_row_cm: 50,
        seed_rate_pre_cultivation_value: 1.2,
        seed_rate_pre_cultivation_unit: 'seeds_per_plant',
        sowing_calculation_safety_percent_pre_cultivation: 20,
        thousand_kernel_weight_g: 3.1,
        harvest_method: 'per_plant',
        expected_yield: 4.5,
      },
      {
        id: 32,
        name: 'Tomate',
        variety: 'Roma',
        crop_species: 7,
        growth_duration_days: 72,
        row_spacing_cm: 70,
        thousand_kernel_weight_g: 3.2,
      },
    ];

    renderCropDetail(
      <CropDetail
        crops={crops}
        selectedCropId={32}
        onCropSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Tomate' })).toBeInTheDocument();
    expect(screen.getAllByText('Roma').length).toBeGreaterThan(0);
    expect(screen.getByText('72 Tage')).toBeInTheDocument();
    expect(screen.getByText('56 Tage')).toBeInTheDocument();
    expect(screen.getByText('1,2 Korn / Pflanze')).toBeInTheDocument();
    expect(screen.getByText('3,2 g')).toBeInTheDocument();
    expect(screen.getByText('Markierte Werte')).toBeInTheDocument();
    expect(screen.getByText('= gelten nur für diese Sorte.')).toBeInTheDocument();
    expect(screen.queryByText('Eigener Wert')).not.toBeInTheDocument();
    expect(screen.queryByText('Aus der Kultur')).not.toBeInTheDocument();
  });

  it('shows edit and plan as labeled primary actions and keeps secondary actions in overflow', async () => {
    const user = userEvent.setup();
    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={vi.fn()}
        onEditCrop={vi.fn()}
        onCreatePlan={vi.fn()}
        onOpenHistory={vi.fn()}
        onPublishCrop={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anbauplan hinzufügen' })).toBeInTheDocument();
    // The public-library action is a permanent button in the badge row, not a
    // menu entry.
    expect(screen.getByRole('button', { name: 'In Bibliothek teilen' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));

    expect(screen.queryByRole('menuitem', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Versionen' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /veröffentlichen|aktualisieren/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('keeps the portrait mobile crop UI in short-height phone landscape', () => {
    mockPhoneLandscapeViewport();

    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={vi.fn()}
        onEditCrop={vi.fn()}
        onCreatePlan={vi.fn()}
        onOpenHistory={vi.fn()}
        onPublishCrop={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Kultur auswählen' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Kulturen' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Bearbeiten' })).getByText('Bearbeiten')).toHaveStyle({
      display: 'none',
    });
    expect(within(screen.getByRole('button', { name: 'Anbauplan hinzufügen' })).getByText('Anbauplan hinzufügen')).toHaveStyle({
      display: 'none',
    });
  });

  it('shows the no-results text in the mobile crop selector', async () => {
    const user = userEvent.setup();
    mockPhoneLandscapeViewport();

    renderCropDetail(
      <CropDetail
        crops={mockCrops}
        selectedCropId={1}
        onCropSelect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Kultur auswählen' }));
    fireEvent.change(screen.getByLabelText(translations.crops.searchPlaceholder), {
      target: { value: 'xyz' },
    });

    expect(screen.getByText(translations.crops.noOptionsEnhanced)).toBeInTheDocument();
  });

  describe('Varieties section', () => {
    const carrotSpecies: Crop = {
      id: 10, name: 'Carrot', variety: '', crop_species: 5, crop_family: 'Apiaceae',
    };
    const carrotNantes: Crop = { id: 11, name: 'Carrot', variety: 'Nantes', crop_species: 5 };
    const carrotBolero: Crop = { id: 12, name: 'Carrot', variety: 'Bolero', crop_species: 5 };
    const carrotCrops: Crop[] = [carrotSpecies, carrotNantes, carrotBolero];

    it('lists sibling varieties from the species view and pre-fills context for "Add variety"', async () => {
      const user = userEvent.setup();
      const onAddVariety = vi.fn();
      renderCropDetail(
        <CropDetail
          crops={carrotCrops}
          selectedCropId={10}
          onCropSelect={vi.fn()}
          onAddVariety={onAddVariety}
        />
      );

      expect(screen.getByText('Sorten')).toBeInTheDocument();
      expect(screen.getByText('Nantes')).toBeInTheDocument();
      expect(screen.getByText('Bolero')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Sorte hinzufügen' }));
      expect(onAddVariety).toHaveBeenCalledWith(carrotSpecies);
    });

    it('shows a tooltip next to the Varieties title explaining the dynamic columns', async () => {
      const user = userEvent.setup();
      renderCropDetail(
        <CropDetail
          crops={carrotCrops}
          selectedCropId={10}
          onCropSelect={vi.fn()}
        />
      );

      const infoIcon = screen.getByTestId('InfoOutlinedIcon');
      await user.hover(infoIcon);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Nur Merkmale werden angezeigt, die vom allgemeinen Kultur-Wert abweichen.'
      );
      await user.unhover(infoIcon);
      await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    });

    it('does not offer edit/delete action buttons in the variety table row (row click is the only interaction)', () => {
      renderCropDetail(
        <CropDetail
          crops={carrotCrops}
          selectedCropId={10}
          onCropSelect={vi.fn()}
          onEditCrop={vi.fn()}
          onDeleteCrop={vi.fn()}
        />
      );

      const nantesRow = screen.getByText('Nantes').closest('.variety-row') as HTMLElement;
      expect(within(nantesRow).queryByRole('button')).not.toBeInTheDocument();
    });

    it('navigates to the variety on row click', () => {
      const onCropSelect = vi.fn();
      renderCropDetail(
        <CropDetail
          crops={carrotCrops}
          selectedCropId={10}
          onCropSelect={onCropSelect}
        />
      );

      fireEvent.click(screen.getByText('Nantes').closest('.variety-row') as HTMLElement);
      expect(onCropSelect).toHaveBeenCalledWith(carrotNantes);
    });

    it('signals the row is clickable with a pointer cursor and a keyboard focus target', () => {
      renderCropDetail(
        <CropDetail
          crops={carrotCrops}
          selectedCropId={10}
          onCropSelect={vi.fn()}
        />
      );

      const nantesRow = screen.getByText('Nantes').closest('.variety-row') as HTMLElement;
      expect(nantesRow).toHaveStyle({ cursor: 'pointer' });
      expect(nantesRow).toHaveAttribute('tabindex', '0');
    });

    it('does not render on a variety\'s own detail view (only on the crop/species overview)', () => {
      renderCropDetail(
        <CropDetail
          crops={carrotCrops}
          selectedCropId={11}
          onCropSelect={vi.fn()}
          onEditCrop={vi.fn()}
          onDeleteCrop={vi.fn()}
        />
      );

      expect(screen.getByText('Carrot')).toBeInTheDocument();
      expect(screen.getByText('Nantes')).toBeInTheDocument();
      expect(screen.queryByText('Sorten')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sorte hinzufügen' })).not.toBeInTheDocument();
      expect(screen.queryByText('Bolero')).not.toBeInTheDocument();
      expect(screen.queryByText('Für diese Kultur sind noch keine Sorten angelegt.')).not.toBeInTheDocument();
    });

    it('shows an empty state when a crop has no varieties yet', () => {
      renderCropDetail(
        <CropDetail
          crops={[carrotSpecies]}
          selectedCropId={10}
          onCropSelect={vi.fn()}
        />
      );

      expect(screen.getByText('Für diese Kultur sind noch keine Sorten angelegt.')).toBeInTheDocument();
    });

    it('shows a table with only the columns where varieties actually differ from each other', () => {
      const species: Crop = {
        id: 20, name: 'Carrot', variety: '', crop_family: 'Apiaceae', row_spacing_cm: 25, growth_duration_days: 100,
      };
      const nantes: Crop = {
        id: 21, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 30, growth_duration_days: 95,
      };
      const bolero: Crop = {
        id: 22, name: 'Carrot', variety: 'Bolero', row_spacing_cm: 30, growth_duration_days: 90,
      };

      renderCropDetail(
        <CropDetail
          crops={[species, nantes, bolero]}
          selectedCropId={20}
          onCropSelect={vi.fn()}
        />
      );

      const table = screen.getByRole('table');
      // row_spacing_cm is the same (30) for both varieties -> no column
      // (it may still appear elsewhere on the page, e.g. the crop's own
      // Spacing section, so this must be scoped to the table).
      expect(within(table).queryByText('Reihenabstand')).not.toBeInTheDocument();
      // growth_duration_days differs between the two varieties -> column shown.
      expect(within(table).getByText('Wachstumszeit (Tage)')).toBeInTheDocument();

      const nantesRow = screen.getByText('Nantes').closest('.variety-row') as HTMLElement;
      expect(within(nantesRow).getByText('95 Tage')).toBeInTheDocument();
      const boleroRow = screen.getByText('Bolero').closest('.variety-row') as HTMLElement;
      expect(within(boleroRow).getByText('90 Tage')).toBeInTheDocument();
    });

    it('shows an em-dash for a variety missing a value in a shown column', () => {
      const species: Crop = { id: 20, name: 'Carrot', variety: '' };
      const nantes: Crop = { id: 21, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 30 };
      const bolero: Crop = { id: 22, name: 'Carrot', variety: 'Bolero' };

      renderCropDetail(
        <CropDetail
          crops={[species, nantes, bolero]}
          selectedCropId={20}
          onCropSelect={vi.fn()}
        />
      );

      const boleroRow = screen.getByText('Bolero').closest('.variety-row') as HTMLElement;
      expect(within(boleroRow).getByText('—')).toBeInTheDocument();
    });

    it('shows the inherited crop value (not an em-dash) for a variety with no own value in a shown column', () => {
      const species: Crop = { id: 20, name: 'Carrot', variety: '', row_spacing_cm: 25 };
      const nantes: Crop = { id: 21, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 30 };
      const bolero: Crop = { id: 22, name: 'Carrot', variety: 'Bolero' };

      renderCropDetail(
        <CropDetail
          crops={[species, nantes, bolero]}
          selectedCropId={20}
          onCropSelect={vi.fn()}
        />
      );

      const boleroRow = screen.getByText('Bolero').closest('.variety-row') as HTMLElement;
      expect(within(boleroRow).queryByText('—')).not.toBeInTheDocument();
      expect(within(boleroRow).getByText('25 cm')).toBeInTheDocument();
    });

    it('hides a column when varieties resolve to the same effective value, even though only one has an explicit own value', () => {
      const species: Crop = { id: 20, name: 'Zucchini', variety: '', row_spacing_cm: 120 };
      const costata: Crop = { id: 21, name: 'Zucchini', variety: 'Costata Romanesco', row_spacing_cm: 120 };
      const testVariety: Crop = { id: 22, name: 'Zucchini', variety: 'test' };

      renderCropDetail(
        <CropDetail
          crops={[species, costata, testVariety]}
          selectedCropId={20}
          onCropSelect={vi.fn()}
        />
      );

      // Costata's own row_spacing_cm (120) equals what "test" inherits from
      // the crop (also 120) — not an actual difference, so no column.
      expect(within(screen.getByRole('table')).queryByText('Reihenabstand')).not.toBeInTheDocument();
    });

    it('resolves seed safety margin from the cultivation-type-specific field, not the unrelated general one', () => {
      const species: Crop = {
        id: 20,
        name: 'Zucchini',
        variety: '',
        cultivation_types: ['pre_cultivation'],
        sowing_calculation_safety_percent_pre_cultivation: 20,
      };
      const costata: Crop = {
        id: 21,
        name: 'Zucchini',
        variety: 'Costata Romanesco',
        cultivation_types: ['pre_cultivation'],
        sowing_calculation_safety_percent_pre_cultivation: 20,
      };
      const testVariety: Crop = { id: 22, name: 'Zucchini', variety: 'test' };

      renderCropDetail(
        <CropDetail
          crops={[species, costata, testVariety]}
          selectedCropId={20}
          onCropSelect={vi.fn()}
        />
      );

      // Both varieties effectively have 20% (Costata's own pre-cultivation
      // value, "test" inheriting the same from the crop) — same value, so
      // the column must not appear at all.
      expect(within(screen.getByRole('table')).queryByText('Sicherheitszuschlag Saatgut')).not.toBeInTheDocument();
    });

    it('uses the same comparison table for exactly one variety, diffed against the general crop', async () => {
      const user = userEvent.setup();
      const species: Crop = { id: 20, name: 'Carrot', variety: '', crop_species: 5, row_spacing_cm: 25 };
      const nantes: Crop = { id: 21, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 40, crop_species: 5 };
      const onAddVariety = vi.fn();

      renderCropDetail(
        <CropDetail
          crops={[species, nantes]}
          selectedCropId={20}
          onCropSelect={vi.fn()}
          onAddVariety={onAddVariety}
        />
      );

      // Same table component/structure as the 2+ varieties case, just with
      // a single row and columns driven by variety-vs-crop instead of
      // variety-vs-variety.
      expect(screen.getByText('Sorten')).toBeInTheDocument();
      const table = screen.getByRole('table');
      expect(within(table).getByText('Nantes')).toBeInTheDocument();
      expect(within(table).getByText('Reihenabstand')).toBeInTheDocument();
      expect(within(table).getByText('40 cm')).toBeInTheDocument();

      const addButton = screen.getByRole('button', { name: 'Sorte hinzufügen' });
      expect(addButton).toBeInTheDocument();
      await user.click(addButton);
      expect(onAddVariety).toHaveBeenCalledWith(species);
    });

    it('shows a "no differences" message in the table row when the sole variety matches the crop exactly', () => {
      const species: Crop = { id: 20, name: 'Carrot', variety: '', crop_species: 5, row_spacing_cm: 25 };
      const nantes: Crop = { id: 21, name: 'Carrot', variety: 'Nantes', crop_species: 5 };

      renderCropDetail(
        <CropDetail
          crops={[species, nantes]}
          selectedCropId={20}
          onCropSelect={vi.fn()}
        />
      );

      const table = screen.getByRole('table');
      expect(within(table).getByText('Nantes')).toBeInTheDocument();
      expect(within(table).getByText('Keine Abweichungen von den allgemeinen Kulturdaten')).toBeInTheDocument();
      expect(within(table).queryByText('Reihenabstand')).not.toBeInTheDocument();
    });

    it('shows the full variety-vs-variety comparison table once a second variety exists', () => {
      const species: Crop = { id: 20, name: 'Carrot', variety: '', crop_species: 5, row_spacing_cm: 25 };
      const nantes: Crop = { id: 21, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 30, crop_species: 5 };
      const bolero: Crop = { id: 22, name: 'Carrot', variety: 'Bolero', row_spacing_cm: 40, crop_species: 5 };

      renderCropDetail(
        <CropDetail
          crops={[species, nantes, bolero]}
          selectedCropId={20}
          onCropSelect={vi.fn()}
        />
      );

      expect(screen.getByText('Sorten')).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Nantes')).toBeInTheDocument();
      expect(screen.getByText('Bolero')).toBeInTheDocument();
      expect(screen.queryByText('Keine Abweichungen von den allgemeinen Kulturdaten')).not.toBeInTheDocument();
    });

    it('leaves the crop sections showing raw crop baseline values regardless of variety count', () => {
      const species: Crop = { id: 20, name: 'Carrot', variety: '', crop_species: 5, row_spacing_cm: 25 };
      const nantes: Crop = { id: 21, name: 'Carrot', variety: 'Nantes', crop_species: 5, row_spacing_cm: 40 };

      renderCropDetail(
        <CropDetail
          crops={[species, nantes]}
          selectedCropId={20}
          onCropSelect={vi.fn()}
        />
      );

      // The crop's own Spacing section always shows its raw value (25),
      // never a variety's — that only appears in the summary above it.
      expect(screen.getByText('25 cm')).toBeInTheDocument();
    });
  });
});
