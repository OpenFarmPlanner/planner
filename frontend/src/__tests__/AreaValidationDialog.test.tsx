import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AreaValidationDialog } from '../components/planting-plans/AreaValidationDialog';
import type { AreaValidationDialogState } from '../pages/useAreaValidationDialog';

type Mode = AreaValidationDialogState['mode'];

const state = (mode: Mode, partial: Partial<AreaValidationDialogState> = {}): AreaValidationDialogState => ({
  rowId: 1,
  requestedArea: 30,
  availableArea: 12.5,
  bedArea: 20,
  occupiedArea: 7.5,
  mode,
  ...partial,
});

const renderDialog = (dialog: AreaValidationDialogState, numberLocale = 'de-DE') => {
  const onClose = vi.fn();
  const onCommit = vi.fn(async () => {});
  const view = render(
    <AreaValidationDialog
      dialog={dialog}
      numberLocale={numberLocale}
      onClose={onClose}
      onCommit={onCommit}
    />,
  );
  return { ...view, onClose, onCommit };
};

/** The areas render with a non-breaking space before the unit. */
const NON_BREAKING_SPACE = '\u00a0';
const area = (formatted: string): string => `${formatted}${NON_BREAKING_SPACE}m²`;

const row = (label: string): HTMLElement =>
  screen.getByText((_content, element) => element?.textContent === label, { selector: 'p' });

const queryRow = (prefix: string): HTMLElement | null =>
  screen.queryByText((_content, element) => Boolean(element?.textContent?.startsWith(prefix)), {
    selector: 'p',
  });

const commitButton = (): HTMLElement | null =>
  screen.queryByRole('button', { name: /übernehmen$/ });

/**
 * The dialog that explains why a requested planting area was clamped. It holds
 * no state -- `useAreaValidationDialog` and the commit handler live in
 * `PlantingPlans.tsx` -- and it is only ever mounted while a clamp is pending,
 * which is why `open` is hardcoded.
 *
 * What it decides is what each of its three modes shows: which of the four area
 * rows appear, which area the "Übernommen wird" row reports, what the confirm
 * button is called, and whether there is anything to confirm at all. Every
 * number is asserted against the German bundle's formatting, because a row
 * pointed at the neighbouring area still renders a plausible figure.
 */
describe('AreaValidationDialog', () => {
  describe('the bed-limit mode', () => {
    it('says the area exceeds the bed itself', () => {
      renderDialog(state('bedLimit'));
      expect(
        screen.getByText('Die angegebene Fläche überschreitet die Größe dieses Beets.'),
      ).toBeInTheDocument();
    });

    it('shows only the bed, the request and what will be applied', () => {
      renderDialog(state('bedLimit'));
      expect(row(`Beetfläche: ${area('20,00')}`)).toBeInTheDocument();
      expect(row(`Angefragt: ${area('30,00')}`)).toBeInTheDocument();
      expect(row(`Übernommen wird: ${area('20,00')}`)).toBeInTheDocument();
      expect(queryRow('Verfügbare Restfläche')).toBeNull();
      expect(queryRow('Bereits belegt')).toBeNull();
    });

    it('applies the bed area, not the remaining area', () => {
      renderDialog(state('bedLimit', { bedArea: 20, availableArea: 12.5 }));
      expect(row(`Übernommen wird: ${area('20,00')}`)).toBeInTheDocument();
    });

    it('offers to take the bed area over', () => {
      renderDialog(state('bedLimit'));
      expect(screen.getByRole('button', { name: 'Beetfläche übernehmen' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Restfläche übernehmen' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('the remaining-limit mode', () => {
    it('says the area exceeds what is left of the bed', () => {
      renderDialog(state('remainingLimit'));
      expect(
        screen.getByText(
          'Die angegebene Fläche überschreitet die verfügbare Restfläche dieses Beets.',
        ),
      ).toBeInTheDocument();
    });

    it('shows all four areas', () => {
      renderDialog(state('remainingLimit'));
      expect(row(`Verfügbare Restfläche: ${area('12,50')}`)).toBeInTheDocument();
      expect(row(`Beetfläche: ${area('20,00')}`)).toBeInTheDocument();
      expect(row(`Bereits belegt: ${area('7,50')}`)).toBeInTheDocument();
      expect(row(`Angefragt: ${area('30,00')}`)).toBeInTheDocument();
    });

    it('applies the remaining area, not the bed area', () => {
      renderDialog(state('remainingLimit', { bedArea: 20, availableArea: 12.5 }));
      expect(row(`Übernommen wird: ${area('12,50')}`)).toBeInTheDocument();
    });

    it('offers to take the remaining area over', () => {
      renderDialog(state('remainingLimit'));
      expect(screen.getByRole('button', { name: 'Restfläche übernehmen' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Beetfläche übernehmen' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('the no-remaining-area mode', () => {
    it('says the bed has nothing free in this period', () => {
      renderDialog(state('noRemainingArea'));
      expect(
        screen.getByText(
          'Für dieses Beet ist im gewählten Zeitraum keine freie Fläche verfügbar.',
        ),
      ).toBeInTheDocument();
    });

    it('shows what is there and what is taken, but no request and no result', () => {
      renderDialog(state('noRemainingArea', { availableArea: 0, occupiedArea: 20 }));
      expect(row(`Verfügbare Restfläche: ${area('0,00')}`)).toBeInTheDocument();
      expect(row(`Beetfläche: ${area('20,00')}`)).toBeInTheDocument();
      expect(row(`Bereits belegt: ${area('20,00')}`)).toBeInTheDocument();
      expect(queryRow('Angefragt')).toBeNull();
      expect(queryRow('Übernommen wird')).toBeNull();
    });

    /** There is no area to fall back to, so cancelling is the only way out. */
    it('offers nothing to confirm', () => {
      renderDialog(state('noRemainingArea'));
      expect(commitButton()).toBeNull();
      expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
    });
  });

  describe('formatting', () => {
    it('always shows two decimals', () => {
      renderDialog(state('bedLimit', { bedArea: 7, requestedArea: 12.345 }));
      expect(row(`Beetfläche: ${area('7,00')}`)).toBeInTheDocument();
      expect(row(`Angefragt: ${area('12,35')}`)).toBeInTheDocument();
    });

    it('follows the locale it was handed', () => {
      renderDialog(state('bedLimit', { bedArea: 1234.5 }), 'en-US');
      expect(row(`Beetfläche: ${area('1,234.50')}`)).toBeInTheDocument();
    });

    /**
     * The `row` helper above compares `textContent` exactly, so the
     * non-breaking space between the number and the unit is already pinned by
     * every other assertion here. What this adds is the other half of keeping a
     * measurement on one line: the row itself must not wrap either, or a narrow
     * dialog breaks "Beetfläche:" away from its figure.
     */
    it('keeps each measurement on one line', () => {
      renderDialog(state('bedLimit'));
      expect(window.getComputedStyle(row(`Beetfläche: ${area('20,00')}`)).whiteSpace).toBe(
        'nowrap',
      );
    });
  });

  describe('the actions', () => {
    it('hands the whole dialog state back on confirm', async () => {
      const user = userEvent.setup();
      const dialog = state('remainingLimit', { rowId: 42, cropId: 7, plantsCount: 120 });
      const { onCommit, onClose } = renderDialog(dialog);
      await user.click(screen.getByRole('button', { name: 'Restfläche übernehmen' }));
      expect(onCommit).toHaveBeenCalledWith(dialog);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('cancels without committing', async () => {
      const user = userEvent.setup();
      const { onClose, onCommit } = renderDialog(state('bedLimit'));
      await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      const { onClose, onCommit } = renderDialog(state('bedLimit'));
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onCommit).not.toHaveBeenCalled();
    });

    /**
     * The dialog opens over the planting-plan grid, whose own Escape handler
     * would cancel the cell edit underneath, and MUI's `Modal` would close the
     * dialog on Escape by itself. The capture handler exists so that one Escape
     * does exactly one thing: it swallows the key before anything outside the
     * dialog sees it, and marks it handled.
     *
     * A listener on `document` is what shows this, not a React-tree ancestor --
     * the dialog renders into a portal on `document.body`, so a wrapping element
     * never receives its keydown whether propagation is stopped or not.
     */
    it('swallows Escape instead of letting it reach the page', () => {
      const onDocumentKeyDown = vi.fn();
      document.addEventListener('keydown', onDocumentKeyDown);
      const { onClose } = renderDialog(state('bedLimit'));

      const notCancelled = fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      document.removeEventListener('keydown', onDocumentKeyDown);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onDocumentKeyDown).not.toHaveBeenCalled();
      expect(notCancelled).toBe(false);
    });

    it('closes on a click outside itself', async () => {
      const user = userEvent.setup();
      const { onClose, onCommit } = renderDialog(state('bedLimit'));
      await user.click(document.querySelector('.MuiBackdrop-root') as HTMLElement);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('lets other keys through', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog(state('bedLimit'));
      await user.keyboard('{Enter}');
      await user.keyboard('a');
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
