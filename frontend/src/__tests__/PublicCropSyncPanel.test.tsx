import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoTooltip, tooltipOf } from './helpers/disabledActionTooltip';
import type { PublicCropSyncFieldChange } from '../api/types';
import { PublicCropSyncPanel } from '../crops/PublicCropSyncPanel';
import { buildDefaultSyncChoices } from '../crops/publicCropSync';
import { ThemeProvider, getContrastRatio } from '@mui/material/styles';
import appTheme from '../theme';
import {
  SYNC_COLUMN_PALETTE,
  syncColumnAccent,
  syncColumnTextColor,
} from '../crops/publicCropSyncStyles';

/**
 * `-webkit-line-clamp` truncation is detected via `scrollHeight` vs.
 * `clientHeight` (see `PublicCropSyncPanel.tsx`), which jsdom never computes
 * from layout. Mirrors the mocking approach in `OverflowTooltip.test.tsx`.
 */
function mockClampedOverflow(element: HTMLElement, overflowing: boolean): void {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 80 });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: overflowing ? 200 : 80 });
}

/**
 * jsdom has no real ResizeObserver, so the component's re-measure path is
 * otherwise unreachable in tests. This stub records the observed element per
 * instance and lets a test fire the callback manually after mocking sizes.
 */
class TestResizeObserver {
  static instances: TestResizeObserver[] = [];

  element: Element | null = null;

  private readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.element = element;
  }

  unobserve(): void {}

  disconnect(): void {
    TestResizeObserver.instances = TestResizeObserver.instances.filter((instance) => instance !== this);
  }

  trigger(): void {
    this.callback();
  }
}

beforeEach(() => {
  TestResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CHANGES: PublicCropSyncFieldChange[] = [
  { field: 'growth_duration_days', local_value: 60, public_value: 50, pushable: true },
  { field: 'harvest_duration_days', local_value: 20, public_value: 25, pushable: true },
  { field: 'notes', local_value: 'Mein Text', public_value: '', pushable: true },
];

function Harness({
  changes = CHANGES,
  requiresModeration = false,
  allowLocal = false,
}: { changes?: PublicCropSyncFieldChange[] | null; requiresModeration?: boolean; allowLocal?: boolean }) {
  const [choices, setChoices] = useState(() => buildDefaultSyncChoices(changes ?? [], { allowLocal }));
  return (
    <PublicCropSyncPanel
      changes={changes}
      choices={choices}
      onChoicesChange={setChoices}
      requiresModeration={requiresModeration}
      allowLocal={allowLocal}
    />
  );
}

const summary = () => screen.getByTestId('public-crop-sync-summary');

describe('PublicCropSyncPanel', () => {
  it('shows both values per differing field and a live summary of the preselection', () => {
    render(<Harness />);

    const row = screen.getByTestId('public-crop-sync-row-growth_duration_days');
    expect(within(row).getByText('Wachstumszeit (Tage)')).toBeInTheDocument();
    expect(within(row).getByText('50')).toBeInTheDocument();
    expect(within(row).getByText('60')).toBeInTheDocument();
    expect(summary()).toHaveTextContent(
      '2 Werte werden in deine Kultur übernommen, 1 Wert wird in der Kulturbibliothek aktualisiert.',
    );
  });

  it('updates the summary when a single choice changes', () => {
    render(<Harness />);

    const row = screen.getByTestId('public-crop-sync-row-growth_duration_days');
    fireEvent.click(within(row).getByRole('radio', { name: 'Meinen Wert übernehmen' }));

    expect(summary()).toHaveTextContent(
      '1 Wert wird in deine Kultur übernommen, 2 Werte werden in der Kulturbibliothek aktualisiert.',
    );
  });

  it('selects a side by clicking its value and marks only that side as chosen', () => {
    render(<Harness />);

    const row = screen.getByTestId('public-crop-sync-row-growth_duration_days');
    expect(within(row).getByRole('radiogroup', { name: 'Welcher Wert gilt für „Wachstumszeit (Tage)“?' }))
      .toBeInTheDocument();
    expect(within(row).getByRole('radio', { name: 'Aus Bibliothek übernehmen' })).toBeChecked();

    fireEvent.click(within(row).getByText('60'));

    expect(within(row).getByRole('radio', { name: 'Meinen Wert übernehmen' })).toBeChecked();
    expect(within(row).getByRole('radio', { name: 'Aus Bibliothek übernehmen' })).not.toBeChecked();
    expect(within(row).getByTestId(/^public-crop-sync-option-mine-/)).toHaveAttribute('data-selected', 'true');
    expect(summary()).toHaveTextContent(
      '1 Wert wird in deine Kultur übernommen, 2 Werte werden in der Kulturbibliothek aktualisiert.',
    );
  });

  it('hides the part of the summary whose count is zero after a quick action', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Alle aus Bibliothek' }));
    expect(summary()).toHaveTextContent('3 Werte werden in deine Kultur übernommen.');
    expect(summary()).not.toHaveTextContent('Kulturbibliothek');

    fireEvent.click(screen.getByRole('button', { name: 'Alle meine Werte' }));
    expect(summary()).toHaveTextContent('3 Werte werden in der Kulturbibliothek aktualisiert.');
  });

  it('reads as a submission for review when contributions are moderated', () => {
    render(<Harness requiresModeration />);

    expect(summary()).toHaveTextContent('1 Wert wird zur Prüfung eingereicht.');
  });

  it('keeps a field that cannot be pushed on the library side', () => {
    render(<Harness changes={[{ field: 'name', local_value: 'Tomate', public_value: 'Tomato', pushable: false }]} />);

    const row = screen.getByTestId('public-crop-sync-row-name');
    expect(within(row).getByRole('radio', { name: 'Meinen Wert übernehmen' })).toBeDisabled();
    fireEvent.click(within(row).getByText('Tomate'));
    expect(within(row).getByRole('radio', { name: 'Aus Bibliothek übernehmen' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Alle meine Werte' }));
    expect(summary()).toHaveTextContent('1 Wert wird in deine Kultur übernommen.');
  });

  it('explains that taking the library neighbours replaces them, shared pairs included', () => {
    const neighbour = { species: null, species_name: '', family: 'Brassicaceae', kind: 'good', reason: 'other', note: '' };
    render(<Harness changes={[{ field: 'companions', local_value: [], public_value: [neighbour], pushable: false }]} />);

    expect(screen.getByTestId('public-crop-sync-companions-hint')).toBeInTheDocument();
  });

  it('shows no choice UI without differences', () => {
    render(<Harness changes={[]} />);

    expect(screen.getByText('Keine Abweichungen zum öffentlichen Eintrag.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alle aus Bibliothek' })).not.toBeInTheDocument();
  });

  it('opens a link inside a Markdown value without switching sides', () => {
    const changes: PublicCropSyncFieldChange[] = [
      { field: 'notes', local_value: 'Mein Text', public_value: '[Quelle](https://example.com)', pushable: true },
    ];
    render(<Harness changes={changes} />);

    const row = screen.getByTestId('public-crop-sync-row-notes');
    fireEvent.click(within(row).getByRole('radio', { name: 'Meinen Wert übernehmen' }));
    fireEvent.click(within(row).getByRole('link', { name: 'Quelle' }));
    expect(within(row).getByRole('radio', { name: 'Meinen Wert übernehmen' })).toBeChecked();
  });

  it('renders Markdown values with the shared Markdown renderer, opening links in a new tab', () => {
    const changes: PublicCropSyncFieldChange[] = [
      {
        field: 'notes',
        local_value: 'Mein Text',
        public_value: '## Titel\n\n[Quelle](https://example.com)',
        pushable: true,
      },
    ];
    render(<Harness changes={changes} />);

    const row = screen.getByTestId('public-crop-sync-row-notes');
    expect(within(row).getByRole('heading', { level: 2, name: 'Titel' })).toBeInTheDocument();
    const link = within(row).getByRole('link', { name: 'Quelle' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('hides the expand toggle when neither compared value is truncated', () => {
    render(<Harness />);

    const row = screen.getByTestId('public-crop-sync-row-notes');
    expect(within(row).queryByTestId('public-crop-sync-toggle-notes')).not.toBeInTheDocument();
  });

  it('shows the expand toggle only once a value is actually truncated, and toggles both columns together', () => {
    const changes: PublicCropSyncFieldChange[] = [
      { field: 'notes', local_value: 'Mein sehr langer Text …', public_value: '', pushable: true },
    ];
    render(<Harness changes={changes} />);

    const row = screen.getByTestId('public-crop-sync-row-notes');
    expect(within(row).queryByTestId('public-crop-sync-toggle-notes')).not.toBeInTheDocument();

    const mineContent = within(row).getByTestId('public-crop-sync-value-content-mine-notes');
    mockClampedOverflow(mineContent, true);
    const observer = TestResizeObserver.instances.find((instance) => instance.element === mineContent);
    expect(observer).toBeDefined();
    act(() => observer?.trigger());

    const toggle = within(row).getByTestId('public-crop-sync-toggle-notes');
    expect(toggle).toHaveTextContent('Ganzen Text anzeigen');

    fireEvent.click(toggle);
    expect(within(row).getByTestId('public-crop-sync-toggle-notes')).toHaveTextContent('Weniger anzeigen');

    fireEvent.click(within(row).getByTestId('public-crop-sync-toggle-notes'));
    expect(within(row).getByTestId('public-crop-sync-toggle-notes')).toHaveTextContent('Ganzen Text anzeigen');
  });

  describe('with "Nur lokal"', () => {
    const PINNABLE_CHANGES: PublicCropSyncFieldChange[] = [
      { field: 'growth_duration_days', local_value: 60, public_value: 50, pushable: true, pinnable: true },
      {
        field: 'harvest_duration_days', local_value: 20, public_value: 25, pushable: true, pinned: true, pinnable: true,
      },
      { field: 'notes', local_value: '', public_value: 'Text', pushable: true, pinnable: false },
    ];

    it('offers three choices with direction headings and keeps a pinned field on "Nur lokal"', () => {
      render(<Harness changes={PINNABLE_CHANGES} allowLocal />);

      expect(screen.getByTestId('public-crop-sync-heading-library')).toHaveTextContent('in meine Kultur übernehmen');
      expect(screen.getByTestId('public-crop-sync-heading-mine')).toHaveTextContent('in der Bibliothek teilen');
      expect(screen.getByTestId('public-crop-sync-heading-local')).toHaveTextContent('behalten, nicht teilen');
      const pinnedRow = screen.getByTestId('public-crop-sync-row-harvest_duration_days');
      expect(within(pinnedRow).getByRole('radio', { name: 'Nur lokal behalten' })).toBeChecked();
      expect(within(pinnedRow).getByTestId('public-crop-sync-pinned-hint-harvest_duration_days'))
        .toHaveTextContent('bisher lokal fixiert');
      expect(screen.getByTestId('public-crop-sync-local-info')).toHaveTextContent(
        'Lokal fixierte Werte gelten nur für deinen Betrieb',
      );
      expect(summary()).toHaveTextContent(
        '2 Werte werden in deine Kultur übernommen, 1 Wert bleibt nur lokal.',
      );
    });

    it('disables "Nur lokal" for a field without a local value', () => {
      render(<Harness changes={PINNABLE_CHANGES} allowLocal />);

      const row = screen.getByTestId('public-crop-sync-row-notes');
      expect(within(row).getByRole('radio', { name: 'Nur lokal behalten' })).toBeDisabled();
    });

    it('sets every row at once with the bulk actions and counts all three parts', () => {
      render(<Harness changes={PINNABLE_CHANGES} allowLocal />);

      fireEvent.click(screen.getByRole('button', { name: 'Alle nur lokal' }));
      expect(summary()).toHaveTextContent('1 Wert wird in deine Kultur übernommen, 2 Werte bleiben nur lokal.');

      fireEvent.click(screen.getByRole('button', { name: 'Alle teilen' }));
      expect(summary()).toHaveTextContent('3 Werte werden in der Kulturbibliothek aktualisiert.');

      const row = screen.getByTestId('public-crop-sync-row-growth_duration_days');
      fireEvent.click(within(row).getByRole('radio', { name: 'Nur lokal behalten' }));
      fireEvent.click(within(screen.getByTestId('public-crop-sync-row-notes'))
        .getByRole('radio', { name: 'Aus Bibliothek übernehmen' }));
      expect(summary()).toHaveTextContent(
        '1 Wert wird in deine Kultur übernommen, 1 Wert wird in der Kulturbibliothek aktualisiert, 1 Wert bleibt nur lokal.',
      );
    });

    it('keeps the two-option layout without "Nur lokal" (link confirmation)', () => {
      render(<Harness changes={PINNABLE_CHANGES} />);

      expect(screen.queryByRole('radio', { name: 'Nur lokal behalten' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('public-crop-sync-local-info')).not.toBeInTheDocument();
      expect(screen.queryByTestId('public-crop-sync-pinned-hint-harvest_duration_days')).not.toBeInTheDocument();
    });
  });

  describe('"Nur lokal" availability (from the preview\'s `pinnable` / `pin_blocked_reason`)', () => {
    const localOption = (field: string) => screen.getByTestId(`public-crop-sync-row-${field}`)
      .querySelector('[data-choice="local"]') as HTMLElement;
    const localRadio = (field: string) => within(screen.getByTestId(`public-crop-sync-row-${field}`))
      .getByRole('radio', { name: 'Nur lokal behalten' });
    const SPECIES_TOOLTIP = 'Dieser Wert gilt für die ganze Kulturart';

    it('offers every field but the name on a general crop, species-invariant fields included', async () => {
      const user = userEvent.setup();
      const changes: PublicCropSyncFieldChange[] = [
        { field: 'name', local_value: 'Mangold lokal', public_value: 'Mangold', pushable: false, pinnable: false, pin_blocked_reason: 'identity' },
        ...['notes', 'crop_family', 'nutrient_demand', 'cultivation_types', 'cultivation_type', 'growth_duration_days',
          'expected_yield', 'row_spacing_m', 'thousand_kernel_weight_g'].map((field) => ({
          field, local_value: 'x', public_value: 'y', pushable: true, pinnable: true, pin_blocked_reason: null,
        })),
      ];
      render(<Harness changes={changes} allowLocal />);

      changes.slice(1).forEach(({ field }) => expect(localRadio(field)).toBeEnabled());
      expect(localRadio('name')).toBeDisabled();
      expect(await tooltipOf(user, localOption('name'))).toHaveTextContent(
        'Name und Sorte gehören zum öffentlichen Eintrag',
      );
      expect(screen.queryByText(new RegExp(SPECIES_TOOLTIP))).not.toBeInTheDocument();
    });

    it('blocks only the species-invariant fields on a linked variety, with their own tooltip', async () => {
      const user = userEvent.setup();
      const changes: PublicCropSyncFieldChange[] = [
        { field: 'nutrient_demand', local_value: 'high', public_value: 'low', pushable: true, pinnable: false, pin_blocked_reason: 'species_invariant' },
        { field: 'growth_duration_days', local_value: 60, public_value: 50, pushable: true, pinnable: true, pin_blocked_reason: null },
      ];
      render(<Harness changes={changes} allowLocal />);

      expect(localRadio('growth_duration_days')).toBeEnabled();
      await expectNoTooltip(user, localOption('growth_duration_days'));
      expect(localRadio('nutrient_demand')).toBeDisabled();
      expect(await tooltipOf(user, localOption('nutrient_demand'))).toHaveTextContent(SPECIES_TOOLTIP);
    });

    it('never guesses a reason the preview did not name', async () => {
      const user = userEvent.setup();
      render(<Harness changes={[{ field: 'notes', local_value: 'x', public_value: 'y', pushable: true }]} allowLocal />);

      expect(localRadio('notes')).toBeDisabled();
      await expectNoTooltip(user, localOption('notes'));
    });
  });

  describe('a row without a local value (only the library has one)', () => {
    const EMPTY_TOOLTIP = 'Deine Kultur hat hier keinen eigenen Wert. Leere Werte werden weder geteilt noch lokal behalten.';
    const changes: PublicCropSyncFieldChange[] = [
      {
        field: 'notes', local_value: '', public_value: 'Bibliothekstext', pushable: false,
        push_blocked_reason: 'empty', pinnable: false, pin_blocked_reason: 'empty',
      },
      {
        field: 'propagation_duration_days', local_value: null, public_value: 14, pushable: false,
        push_blocked_reason: 'empty', pinnable: false, pin_blocked_reason: 'empty',
      },
      {
        field: 'growth_duration_days', local_value: 60, public_value: 50, pushable: true,
        push_blocked_reason: null, pinnable: true, pin_blocked_reason: null,
      },
    ];
    const row = (field: string) => screen.getByTestId(`public-crop-sync-row-${field}`);
    const option = (field: string, choice: string) => row(field).querySelector(`[data-choice="${choice}"]`) as HTMLElement;

    it('preselects the library, disables both other options with one tooltip and counts the row as taken over', async () => {
      const user = userEvent.setup();
      render(<Harness changes={changes} allowLocal />);

      const propagation = within(row('propagation_duration_days'));
      expect(propagation.getByRole('radio', { name: 'Aus Bibliothek übernehmen' })).toBeChecked();
      expect(propagation.getByRole('radio', { name: 'Meinen Wert übernehmen' })).toBeDisabled();
      expect(propagation.getByRole('radio', { name: 'Nur lokal behalten' })).toBeDisabled();
      expect(await tooltipOf(user, option('propagation_duration_days', 'mine'))).toHaveTextContent(EMPTY_TOOLTIP);
      await user.unhover(option('propagation_duration_days', 'mine').parentElement as HTMLElement);
      expect(await tooltipOf(user, option('propagation_duration_days', 'local'))).toHaveTextContent(EMPTY_TOOLTIP);
      expect(summary()).toHaveTextContent('3 Werte werden in deine Kultur übernommen.');
    });

    it('stays on the library side for "Alle teilen" and "Alle nur lokal"', () => {
      render(<Harness changes={changes} allowLocal />);

      fireEvent.click(screen.getByRole('button', { name: 'Alle teilen' }));
      expect(within(row('notes')).getByRole('radio', { name: 'Aus Bibliothek übernehmen' })).toBeChecked();
      expect(summary()).toHaveTextContent(
        '2 Werte werden in deine Kultur übernommen, 1 Wert wird in der Kulturbibliothek aktualisiert.',
      );

      fireEvent.click(screen.getByRole('button', { name: 'Alle nur lokal' }));
      expect(within(row('propagation_duration_days')).getByRole('radio', { name: 'Aus Bibliothek übernehmen' }))
        .toBeChecked();
      expect(summary()).toHaveTextContent('2 Werte werden in deine Kultur übernommen, 1 Wert bleibt nur lokal.');
    });
  });

  describe('values as the crop form shows them', () => {
    it('translates choice values, localizes numbers and shows distances in centimetres', () => {
      const changes: PublicCropSyncFieldChange[] = [
        { field: 'cultivation_type', local_value: 'direct_sowing', public_value: 'pre_cultivation', pushable: true },
        { field: 'expected_yield', local_value: '16.00', public_value: '2.50', pushable: true },
        { field: 'row_spacing_m', local_value: 0.4, public_value: null, pushable: true },
        { field: 'sowing_depth_m', local_value: 0.015, public_value: null, pushable: true },
        { field: 'thousand_kernel_weight_g', local_value: '14.00', public_value: '3.90', pushable: true },
      ];
      render(<Harness changes={changes} />);

      const rowText = (field: string) => screen.getByTestId(`public-crop-sync-row-${field}`).textContent;
      expect(rowText('cultivation_type')).toContain('Pflanzung');
      expect(rowText('cultivation_type')).toContain('Direktsaat');
      expect(rowText('cultivation_type')).not.toContain('direct_sowing');
      expect(rowText('expected_yield')).toContain('16');
      expect(rowText('expected_yield')).toContain('2,5');
      expect(rowText('expected_yield')).not.toContain('16.00');
      expect(rowText('row_spacing_m')).toContain('Reihenabstand (cm)');
      expect(rowText('row_spacing_m')).toContain('40');
      expect(rowText('sowing_depth_m')).toContain('Saattiefe (cm)');
      expect(rowText('sowing_depth_m')).toContain('1,5');
      expect(rowText('thousand_kernel_weight_g')).toContain('3,9');
      expect(rowText('thousand_kernel_weight_g')).not.toContain('14.00');
    });
  });

  describe('column colours', () => {
    const PINNABLE: PublicCropSyncFieldChange[] = [
      { field: 'growth_duration_days', local_value: 60, public_value: 50, pushable: true, pinnable: true },
      { field: 'harvest_duration_days', local_value: 20, public_value: 25, pushable: true, pinnable: true },
    ];
    const renderThemed = () => render(
      <ThemeProvider theme={appTheme}>
        <Harness changes={PINNABLE} allowLocal />
      </ThemeProvider>,
    );

    it('maps library to pull (info), mine to push (warning) and local to the pin colour', () => {
      expect(SYNC_COLUMN_PALETTE).toEqual({ library: 'info', mine: 'warning', local: 'libraryLocal' });
      expect(syncColumnAccent(appTheme, 'library')).toBe(appTheme.palette.info.main);
      expect(syncColumnAccent(appTheme, 'mine')).toBe(appTheme.palette.warning.main);
      expect(syncColumnAccent(appTheme, 'local')).toBe(appTheme.palette.libraryLocal.main);
    });

    it('keeps every column text colour at 4.5:1 or more on the panel background', () => {
      (['library', 'mine', 'local'] as const).forEach((column) => {
        expect(getContrastRatio(syncColumnTextColor(appTheme, column), appTheme.palette.background.paper))
          .toBeGreaterThanOrEqual(4.5);
      });
    });

    it('colours each heading title and the chosen option in its column colour, never in green', () => {
      renderThemed();
      (['library', 'mine', 'local'] as const).forEach((column) => {
        expect(screen.getByTestId(`public-crop-sync-heading-${column}-title`))
          .toHaveStyle({ color: syncColumnTextColor(appTheme, column) });
      });

      const row = screen.getByTestId('public-crop-sync-row-growth_duration_days');
      const localRadio = within(row).getByRole('radio', { name: 'Nur lokal behalten' });
      fireEvent.click(localRadio);
      expect(localRadio.parentElement).toHaveStyle({ borderColor: appTheme.palette.libraryLocal.main });
      fireEvent.click(within(row).getByRole('radio', { name: 'Aus Bibliothek übernehmen' }));
      const libraryOption = within(row).getByRole('radio', { name: 'Aus Bibliothek übernehmen' }).parentElement as HTMLElement;
      expect(libraryOption).toHaveAttribute('data-selected', 'true');
      expect(libraryOption).toHaveStyle({ borderColor: appTheme.palette.info.main });
      expect(libraryOption).not.toHaveStyle({ borderColor: appTheme.palette.primary.main });
    });

    it('shows the "Nur lokal" info only while at least one row is kept locally', () => {
      renderThemed();
      expect(screen.queryByTestId('public-crop-sync-local-info')).not.toBeInTheDocument();

      const row = screen.getByTestId('public-crop-sync-row-harvest_duration_days');
      fireEvent.click(within(row).getByRole('radio', { name: 'Nur lokal behalten' }));
      expect(screen.getByTestId('public-crop-sync-local-info')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Alle aus Bibliothek' }));
      expect(screen.queryByTestId('public-crop-sync-local-info')).not.toBeInTheDocument();
      PINNABLE.forEach(({ field }) => {
        expect(within(screen.getByTestId(`public-crop-sync-row-${field}`))
          .getByRole('radio', { name: 'Aus Bibliothek übernehmen' })).toBeChecked();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Alle nur lokal' }));
      expect(screen.getByTestId('public-crop-sync-local-info')).toBeInTheDocument();
    });
  });
});
