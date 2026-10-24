import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PublicCropSyncFieldChange } from '../api/types';
import { PublicCropSyncPanel } from '../crops/PublicCropSyncPanel';
import { buildDefaultSyncChoices } from '../crops/publicCropSync';

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
});
