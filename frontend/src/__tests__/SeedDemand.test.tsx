import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SeedDemandPage from '../pages/SeedDemand';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';

const { listMock, saveSelectionMock, cropListMock, planListMock, locationListMock, fieldListMock, bedListMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  saveSelectionMock: vi.fn(),
  cropListMock: vi.fn(),
  planListMock: vi.fn(),
  locationListMock: vi.fn(),
  fieldListMock: vi.fn(),
  bedListMock: vi.fn(),
}));
const projectRequirementState = vi.hoisted(() => ({
  shouldShowProjectRequiredState: false,
  missingProjectReason: null as null | 'no_projects' | 'no_active_project',
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    seedDemandAPI: {
      list: listMock,
      saveSupplierSelection: saveSelectionMock,
    },
    cropAPI: {
      list: cropListMock,
      listAll: async () => (await cropListMock()).data,
    },
    plantingPlanAPI: {
      list: planListMock,
      listAll: async () => (await planListMock()).data,
    },
    locationAPI: {
      list: locationListMock,
      listAll: async () => (await locationListMock()).data,
    },
    fieldAPI: {
      list: fieldListMock,
      listAll: async () => (await fieldListMock()).data,
    },
    bedAPI: {
      list: bedListMock,
      listAll: async () => (await bedListMock()).data,
    },
  };
});

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) => {
      const translations: Record<string, string> = {
        'seedDemand.requiredAmountUnavailable': 'Nicht berechenbar ({{reason}})',
        'seedDemand.requiredAmountUnavailableTooltip': 'Fehlende Angabe: {{reason}}.',
        'seedDemand.requiredAmountUnavailableMultipleTooltip': 'Fehlende Angaben: {{reasons}}.',
        'seedDemand.calculationBlockers.missingArea': 'Beetfläche fehlt',
        'seedDemand.calculationBlockers.missingRowSpacing': 'Reihenabstand fehlt',
        'seedDemand.calculationBlockers.missingTkg': 'TKG fehlt',
        'seedDemand.calculationBlockers.missingData': 'notwendige Angaben fehlen',
        'seedDemand.packageBlockers.requiredAmountUnavailable': 'Kein Packungsvorschlag. {{details}}',
      };
      return Object.entries(options).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        translations[key] ?? key,
      );
    },
  }),
}));

vi.mock('../hooks/useProjectRequirement', () => ({
  useProjectRequirement: () => projectRequirementState,
}));

describe('SeedDemandPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    projectRequirementState.shouldShowProjectRequiredState = false;
    projectRequirementState.missingProjectReason = null;
    saveSelectionMock.mockResolvedValue({ data: { crop_id: 1, selected_supplier_id: 10 } });
    cropListMock.mockResolvedValue({
      data: { results: [{ id: 1, name: 'Basis', seed_rate_value: 1, seed_rate_direct_value: null, seed_rate_pre_cultivation_value: null }] },
    });
    planListMock.mockResolvedValue({ data: { results: [{ id: 1 }] } });
    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof' }] } });
    fieldListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Feld 1', location: 1 }] } });
    bedListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Beet 1' }] } });
  });

  it('shows field-first progressive requirement and no table header when no locations exist', async () => {
    listMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    locationListMock.mockResolvedValue({ data: { results: [] } });
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('seedDemand.progressive.fields.title')).toBeInTheDocument();
    });
    expect(screen.queryByText('seedDemand.columns.crop')).not.toBeInTheDocument();
    expect(screen.queryByText('Keine Einträge vorhanden')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'common:setupActions.createField' })).toHaveAttribute(
      'href',
      '/app/fields-beds?action=add-parcel',
    );
    expect(screen.queryByRole('link', { name: 'common:setupActions.createBed' })).not.toBeInTheDocument();
  });

  it('shows field-step requirement when a location exists but no fields exist', async () => {
    listMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('seedDemand.progressive.fields.title')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'common:setupActions.createField' })).toHaveAttribute(
      'href',
      '/app/fields-beds?action=add-parcel',
    );
    expect(screen.queryByRole('link', { name: 'common:setupActions.createBed' })).not.toBeInTheDocument();
  });

  it('shows crop-step requirement when locations and beds exist but crops are missing', async () => {
    listMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    cropListMock.mockResolvedValue({ data: { results: [] } });
    planListMock.mockResolvedValue({ data: { results: [] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('seedDemand.progressive.crops.title')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'common:setupActions.openCropLibrary' })).toHaveAttribute(
      'href',
      '/app/crops?library=true',
    );
    expect(screen.getByRole('link', { name: 'common:setupActions.createCrop' })).toHaveAttribute(
      'href',
      '/app/crops?create=true',
    );
  });

  it('shows plan-step requirement when crops exist but plans are missing', async () => {
    listMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    cropListMock.mockResolvedValue({
      data: { results: [{ id: 1, name: 'Karotte', seed_rate_value: 2, seed_rate_direct_value: null, seed_rate_pre_cultivation_value: null }] },
    });
    planListMock.mockResolvedValue({ data: { results: [] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('seedDemand.progressive.plans.title')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'common:setupActions.createPlan' })).toBeInTheDocument();
  });

  it('shows no-results empty state when requirements are fulfilled but no rows are calculated', async () => {
    listMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    cropListMock.mockResolvedValue({
      data: { results: [{ id: 1, name: 'Karotte', seed_rate_value: 2, seed_rate_direct_value: null, seed_rate_pre_cultivation_value: null }] },
    });
    planListMock.mockResolvedValue({ data: { results: [{ id: 1 }] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('seedDemand.columns.crop')).toBeInTheDocument();
    });
    expect(screen.getByText('seedDemand.emptyStates.noResultsTitle')).toBeInTheDocument();
    expect(screen.getByText('seedDemand.emptyStates.noResultsDescription')).toBeInTheDocument();
  });

  it('shows project-required info instead of a technical error when no project exists', async () => {
    projectRequirementState.shouldShowProjectRequiredState = true;
    projectRequirementState.missingProjectReason = 'no_projects';

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('projectRequired.noProjectsTitle')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'projectRequired.createProjectAction' })).toBeInTheDocument();
    expect(screen.queryByText('seedDemand.loadError')).not.toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('still shows a load error for real API failures with active project context', async () => {
    listMock.mockRejectedValueOnce(new Error('network failed'));

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('seedDemand.loadError')).toBeInTheDocument();
    });
  });

  it('shows crop with variety in parentheses', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 1,
            crop_name: 'Bohne',
            variety: 'Canadian Wonder',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 184.2,
            required_amount_unit: 'g',
            total_grams: 184.2,
            package_suggestion: {
              selection: [{ size_value: 25, size_unit: 'g', count: 8 }],
              total_amount: 200,
              overage: 15.8,
              pack_count: 8,
            },
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Bohne (Canadian Wonder)' })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Bohne (Canadian Wonder)' })).toHaveAttribute(
      'href',
      '/app/crops?cropId=1'
    );

    expect(screen.getByText('25 seedDemand.unitGrams × 8')).toBeInTheDocument();
    expect(screen.queryByText(/Vorschlag:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/over:/i)).not.toBeInTheDocument();
  });

  it('uses the localized crop display name when the API provides one', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 1,
            crop_name: 'Ackerbohne',
            crop_display_name: 'Broad bean',
            crop_display_language_code: 'en',
            variety: 'Hangdown',
            supplier: 'Open Seeds',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Open Seeds' }],
            selected_supplier_id: 10,
            required_amount_value: 100,
            required_amount_unit: 'g',
            total_grams: 100,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole('link', { name: 'Broad bean (Hangdown)' })).toBeInTheDocument();
    expect(screen.queryByText('Ackerbohne (Hangdown)')).not.toBeInTheDocument();
  });

  it('opens row actions from the right-click context menu and copies the visible row as TSV', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 1,
            crop_name: 'Bohne',
            variety: 'Canadian Wonder',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 184.2,
            required_amount_unit: 'g',
            total_grams: 184.2,
            package_suggestion: {
              selection: [{ size_value: 25, size_unit: 'g', count: 8 }],
              total_amount: 200,
              overage: 15.8,
              pack_count: 8,
            },
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    const cropLink = await screen.findByRole('link', { name: 'Bohne (Canadian Wonder)' });
    const row = cropLink.closest('tr');
    expect(row).not.toBeNull();

    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const stopPropagationSpy = vi.spyOn(contextMenuEvent, 'stopPropagation');
    fireEvent(row as HTMLTableRowElement, contextMenuEvent);
    expect(screen.getByRole('menuitem', { name: 'seedDemand.contextMenu.openCrop' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'seedDemand.contextMenu.editCrop' })).toBeInTheDocument();
    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(stopPropagationSpy).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'actions.copyRow' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'Bohne (Canadian Wonder)\tReinsaat\t184,20 seedDemand.unitGrams\t25 seedDemand.unitGrams × 8',
      );
    });
  });

  it('opens the app context menu when right-clicking directly on an icon inside the row (not the native browser menu)', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 1,
            crop_name: 'Bohne',
            variety: 'Canadian Wonder',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 184.2,
            required_amount_unit: 'g',
            total_grams: 184.2,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    const cropLink = await screen.findByRole('link', { name: 'Bohne (Canadian Wonder)' });
    const actionsButton = screen.getByRole('button', { name: 'common:actions.actions' });
    // The right-click lands on the icon's inner <path>, an SVGElement, not the
    // <button> (HTMLElement) itself - this is what a real right-click on a
    // MUI icon hits, and is the regression this test guards against.
    const iconPath = actionsButton.querySelector('svg path');
    expect(iconPath).not.toBeNull();

    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(iconPath as Element, contextMenuEvent);

    expect(screen.getByRole('menuitem', { name: 'seedDemand.contextMenu.openCrop' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'seedDemand.contextMenu.editCrop' })).toBeInTheDocument();
    // The native browser context menu must not appear alongside the app's own.
    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(cropLink).toBeInTheDocument();
  });

  it('opens the app context menu from a touch long-press on the row, and suppresses the trailing click', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 1,
            crop_name: 'Bohne',
            variety: 'Canadian Wonder',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 184.2,
            required_amount_unit: 'g',
            total_grams: 184.2,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    const cropLink = await screen.findByRole('link', { name: 'Bohne (Canadian Wonder)' });
    const row = cropLink.closest('tr') as HTMLTableRowElement;

    let touchEndEvent: TouchEvent;
    vi.useFakeTimers();
    try {
      fireEvent.touchStart(row, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      // A real browser would synthesize a trailing click from this touchend
      // unless its default is prevented — jsdom doesn't perform that
      // synthesis itself, so defaultPrevented is the testable proxy here.
      touchEndEvent = new TouchEvent('touchend', { bubbles: true, cancelable: true });
      fireEvent(row, touchEndEvent);
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByRole('menuitem', { name: 'seedDemand.contextMenu.openCrop' })).toBeInTheDocument();
    expect(touchEndEvent!.defaultPrevented).toBe(true);
  });

  it('does not open the context menu on a short tap of a seed demand row', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 1,
            crop_name: 'Bohne',
            variety: 'Canadian Wonder',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 184.2,
            required_amount_unit: 'g',
            total_grams: 184.2,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    const cropLink = await screen.findByRole('link', { name: 'Bohne (Canadian Wonder)' });
    const row = cropLink.closest('tr') as HTMLTableRowElement;

    vi.useFakeTimers();
    try {
      fireEvent.touchStart(row, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
      fireEvent.touchEnd(row);
      act(() => {
        vi.advanceTimersByTime(600);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.queryByRole('menuitem', { name: 'seedDemand.contextMenu.openCrop' })).not.toBeInTheDocument();
  });

  it('still opens the icon normally on left-click after the context-menu fix (unchanged behavior)', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 1,
            crop_name: 'Bohne',
            variety: 'Canadian Wonder',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 184.2,
            required_amount_unit: 'g',
            total_grams: 184.2,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await screen.findByRole('link', { name: 'Bohne (Canadian Wonder)' });
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.actions' }));

    expect(screen.getByRole('menuitem', { name: 'seedDemand.contextMenu.openCrop' })).toBeInTheDocument();
  });

  it('leaves the native browser context menu untouched outside the table', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 1,
            crop_name: 'Bohne',
            variety: 'Canadian Wonder',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 184.2,
            required_amount_unit: 'g',
            total_grams: 184.2,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await screen.findByRole('link', { name: 'Bohne (Canadian Wonder)' });

    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(document.body, contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menuitem', { name: 'seedDemand.contextMenu.openCrop' })).not.toBeInTheDocument();
  });

  it('opens row actions from the inline actions menu', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 1,
            crop_name: 'Bohne',
            variety: 'Canadian Wonder',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 184.2,
            required_amount_unit: 'g',
            total_grams: 184.2,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await screen.findByRole('link', { name: 'Bohne (Canadian Wonder)' });
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.actions' }));

    expect(screen.getByRole('menuitem', { name: 'seedDemand.contextMenu.openCrop' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'seedDemand.contextMenu.editCrop' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'actions.copyRow' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'actions.copyTable' })).toBeInTheDocument();
  });

  it('copies the visible seed demand table including headers as TSV', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 2,
            crop_name: 'Salat',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 0.25,
            required_amount_unit: 'g',
            total_grams: 0.25,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    const cropLink = await screen.findByRole('link', { name: 'Salat' });
    const row = cropLink.closest('tr');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row as HTMLTableRowElement);
    fireEvent.click(screen.getByRole('menuitem', { name: 'actions.copyTable' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        [
          'seedDemand.columns.crop\tseedDemand.columns.supplier\tseedDemand.columns.requiredAmount\tseedDemand.columns.packages',
          'Salat\tReinsaat\t0,25 seedDemand.unitGrams\tseedDemand.noPackagesAvailable',
        ].join('\n'),
      );
    });
  });

  it('shows compact fallback text when no package suggestion is available', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 2,
            crop_name: 'Salat',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 0.25,
            required_amount_unit: 'g',
            total_grams: 0.25,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('seedDemand.noPackagesAvailable')).toBeInTheDocument();
    });
  });

  it('shows missing TKG guidance instead of a seed total', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 2,
            crop_name: 'Kresse',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: null,
            required_amount_unit: 'g',
            required_amount_warning: 'missing_tkg',
            total_grams: null,
            package_suggestion: {
              selection: [{ size_value: 1000, size_unit: 'seeds', count: 2 }],
              total_amount: 2000,
              overage: 0,
              pack_count: 2,
              unit: 'seeds',
            },
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    const cropLink = await screen.findByRole('link', { name: 'Kresse' });
    expect(screen.getByText('Nicht berechenbar (TKG fehlt)')).toBeInTheDocument();
    expect(screen.queryByText(/2.000,00 seedDemand.unitSeeds/)).not.toBeInTheDocument();

    const row = cropLink.closest('tr');
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as HTMLTableRowElement);
    fireEvent.click(screen.getByRole('menuitem', { name: 'actions.copyRow' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'Kresse\tReinsaat\tNicht berechenbar (TKG fehlt)\t1.000 seedDemand.unitSeeds × 2',
      );
    });
  });

  it('does not trigger supplier auto-save on initial load', async () => {
    listMock.mockResolvedValueOnce({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 5,
            crop_name: 'Spinat',
            supplier: 'Only Supplier',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Only Supplier' }],
            selected_supplier_id: 10,
            required_amount_value: 12,
            required_amount_unit: 'g',
            total_grams: 12,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Spinat')).toBeInTheDocument();
    });
    expect(saveSelectionMock).not.toHaveBeenCalled();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('shows supplier dropdown when multiple suppliers are available', async () => {
    listMock
      .mockResolvedValueOnce({
        data: {
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              crop_id: 3,
              crop_name: 'Karotte',
              supplier: 'Reinsaat',
              selected_supplier_id: 10,
              supplier_options: [
                { supplier_id: 10, supplier_name: 'Reinsaat' },
                { supplier_id: 11, supplier_name: 'Bingenheimer' },
              ],
              required_amount_value: 55,
              required_amount_unit: 'g',
              total_grams: 55,
              package_suggestion: {
                selection: [{ size_value: 5, size_unit: 'g', count: 1 }, { size_value: 50, size_unit: 'g', count: 1 }],
                total_amount: 55,
                overage: 0,
                pack_count: 2,
              },
              warning: null,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              crop_id: 3,
              crop_name: 'Karotte',
              supplier: 'Bingenheimer',
              selected_supplier_id: 11,
              supplier_options: [
                { supplier_id: 10, supplier_name: 'Reinsaat' },
                { supplier_id: 11, supplier_name: 'Bingenheimer' },
              ],
              required_amount_value: 55,
              required_amount_unit: 'g',
              total_grams: 55,
              package_suggestion: {
                selection: [{ size_value: 25, size_unit: 'g', count: 1 }, { size_value: 100, size_unit: 'g', count: 1 }],
                total_amount: 125,
                overage: 70,
                pack_count: 2,
              },
              warning: null,
            },
          ],
        },
      });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Bingenheimer' }));

    await waitFor(() => {
      expect(saveSelectionMock).toHaveBeenCalledWith(3, 11);
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });

  it('shows read-only supplier state when no suppliers are available', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 4,
            crop_name: 'Mangold',
            supplier: '',
            selected_supplier_id: null,
            supplier_options: [],
            required_amount_value: 4,
            required_amount_unit: 'g',
            total_grams: 4,
            package_suggestion: null,
            warning: 'Keine Lieferantendaten vorhanden.',
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('seedDemand.noSupplierAvailable')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'seedDemand.editCropAction' })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'seedDemand.editCropAction' })).toHaveAttribute(
      'href',
      '/app/crops?cropId=4&action=edit',
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows single supplier as read-only without auto-saving selection', async () => {
    listMock.mockResolvedValueOnce({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 5,
            crop_name: 'Spinat',
            supplier: '',
            selected_supplier_id: null,
            supplier_options: [{ supplier_id: 22, supplier_name: 'Reinsaat' }],
            required_amount_value: 12,
            required_amount_unit: 'g',
            total_grams: 12,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Spinat')).toBeInTheDocument();
    });
    expect(saveSelectionMock).not.toHaveBeenCalled();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('seedDemand.noPackagesAvailable')).toBeInTheDocument();
    expect(screen.getByText('Reinsaat')).toBeInTheDocument();
    expect(screen.queryByText('seedDemand.selectSupplier')).not.toBeInTheDocument();
    const supplierSelect = screen.getByRole('combobox');
    expect(supplierSelect).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows placeholder only for rows with multiple suppliers and no selected supplier', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 6,
            crop_name: 'Rote Bete',
            supplier: '',
            selected_supplier_id: null,
            supplier_options: [
              { supplier_id: 30, supplier_name: 'Supplier A' },
              { supplier_id: 31, supplier_name: 'Supplier B' },
            ],
            required_amount_value: 18,
            required_amount_unit: 'g',
            total_grams: 18,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'seedDemand.selectSupplier' })).toBeInTheDocument();
  });

  it('renders exactly one row per crop in seed demand table', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 10,
            crop_name: 'Karotte',
            supplier_options: [{ supplier_id: 1, supplier_name: 'Supplier A' }],
            selected_supplier_id: 1,
            required_amount_value: 20,
            required_amount_unit: 'g',
            total_grams: 20,
            package_suggestion: null,
            warning: null,
          },
          {
            crop_id: 11,
            crop_name: 'Salat',
            supplier_options: [{ supplier_id: 2, supplier_name: 'Supplier B' }],
            selected_supplier_id: 2,
            required_amount_value: 10,
            required_amount_unit: 'g',
            total_grams: 10,
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('row', { name: /Karotte/i })).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Salat/i })).toBeInTheDocument();
    });

    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('shows a plain dash without a link in the packages column when no supplier is configured', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 7,
            crop_name: 'Mangold',
            supplier: '',
            selected_supplier_id: null,
            supplier_options: [],
            required_amount_value: 4,
            required_amount_unit: 'g',
            total_grams: 4,
            package_suggestion: null,
            warning: 'Keine Lieferantendaten vorhanden.',
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Mangold')).toBeInTheDocument();
    });
    const row = screen.getByText('Mangold').closest('tr');
    expect(row).not.toBeNull();
    const cells = (row as HTMLTableRowElement).querySelectorAll('td');
    const packagesCell = cells[cells.length - 1];
    expect(packagesCell.textContent).toBe('—');
    expect(packagesCell.querySelector('a')).toBeNull();
    const tooltipTrigger = packagesCell.querySelector('.ofp-full-cell-tooltip-trigger');
    expect(tooltipTrigger).not.toBeNull();
    expect(tooltipTrigger).toHaveStyle({ position: 'absolute', inset: '0' });
    fireEvent.mouseOver(tooltipTrigger as Element);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('seedDemand.noSupplierConfiguredTooltip');
  });

  it('shows a not-configured link in the packages column when the supplier has no packaging sizes', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 8,
            crop_name: 'Radieschen',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 30,
            required_amount_unit: 'g',
            total_grams: 30,
            seed_packages: [],
            package_suggestion: null,
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /seedDemand.noPackagesAvailable/ })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /seedDemand.noPackagesAvailable/ })).toHaveAttribute(
      'href',
      '/app/crops?cropId=8&action=edit',
    );
  });

  it('shows a distinctly styled calculation error when supplier and packaging data exist but no suggestion could be computed', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 9,
            crop_name: 'Pastinake',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: 30,
            required_amount_unit: 'g',
            total_grams: 30,
            seed_packages: [{ size_value: 25, size_unit: 'g' }],
            package_suggestion: null,
            warning: 'Inconsistent data.',
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/seedDemand.noPackageCalculationPossible/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /seedDemand.noPackageCalculationPossible/ })).not.toBeInTheDocument();
  });

  it('shows calculation blockers and full-cell tooltips when total demand is unavailable', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            crop_id: 10,
            crop_name: 'Mais',
            variety: 'rot',
            supplier: 'Reinsaat',
            supplier_options: [{ supplier_id: 10, supplier_name: 'Reinsaat' }],
            selected_supplier_id: 10,
            required_amount_value: null,
            required_amount_unit: 'g',
            required_amount_warning: null,
            calculation_blockers: ['missing_row_spacing', 'missing_area'],
            total_grams: null,
            seed_packages: [{ size_value: 25, size_unit: 'g' }],
            package_suggestion: null,
            package_blocker: 'required_amount_unavailable',
            warning: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <SeedDemandPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>
    );

    const cropLink = await screen.findByRole('link', { name: 'Mais (rot)' });
    const row = cropLink.closest('tr');
    expect(row).not.toBeNull();
    const cells = Array.from((row as HTMLTableRowElement).querySelectorAll('td'));
    expect(cells.at(-2)?.textContent).toBe('Nicht berechenbar (Beetfläche fehlt)');
    expect(cells.at(-1)?.textContent).toBe('—');

    const requiredAmountTrigger = cells.at(-2)?.querySelector('.ofp-full-cell-tooltip-trigger');
    expect(requiredAmountTrigger).not.toBeNull();
    fireEvent.mouseOver(requiredAmountTrigger as Element);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Fehlende Angaben: Beetfläche fehlt, Reihenabstand fehlt.',
    );
    fireEvent.mouseOut(requiredAmountTrigger as Element);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    const packageTrigger = cells.at(-1)?.querySelector('.ofp-full-cell-tooltip-trigger');
    expect(packageTrigger).not.toBeNull();
    fireEvent.mouseOver(packageTrigger as Element);
    expect(await screen.findByRole('tooltip', { name: /Kein Packungsvorschlag/ })).toHaveTextContent(
      'Kein Packungsvorschlag. Fehlende Angaben: Beetfläche fehlt, Reihenabstand fehlt.',
    );
  });
});
