import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MobileCardList } from '../components/mobile/MobileCardList';

interface Plan {
  id: number;
  crop: string;
  bed: string;
}

const PLANS: Plan[] = [
  { id: 1, crop: 'Karotte (Nantaise)', bed: 'Beet 1' },
  { id: 2, crop: 'Tomate (Matina)', bed: 'Beet 2' },
];

interface RenderOptions {
  items?: Plan[];
  expandedIds?: Set<string | number>;
  withSecondary?: boolean;
  withHeaderAction?: boolean;
  withActions?: boolean;
  withFooter?: boolean;
  emptyState?: React.ReactNode;
}

const renderList = ({
  items = PLANS,
  expandedIds = new Set<string | number>(),
  withSecondary = true,
  withHeaderAction = false,
  withActions = false,
  withFooter = false,
  emptyState,
}: RenderOptions = {}) => {
  const onToggleExpanded = vi.fn();
  const onHeaderAction = vi.fn();
  const view = render(
    <MobileCardList<Plan>
      items={items}
      expandedIds={expandedIds}
      onToggleExpanded={onToggleExpanded}
      renderPrimary={(item) => item.crop}
      renderSecondary={withSecondary ? (item) => item.bed : undefined}
      renderDetails={(item) => <div data-testid={`details-${item.id}`}>Pflanzdatum 1.3.2026</div>}
      renderHeaderAction={withHeaderAction
        ? (item) => (
          <button type="button" onClick={onHeaderAction} aria-label={`Menü ${item.crop}`}>
            ⋮
          </button>
        )
        : undefined}
      renderActions={withActions
        ? (item) => <button type="button" data-testid={`action-${item.id}`}>Bearbeiten</button>
        : undefined}
      renderFooter={withFooter ? (item) => <div data-testid={`footer-${item.id}`}>2 m²</div> : undefined}
      emptyState={emptyState}
      detailsShowLabel="Details anzeigen"
      detailsHideLabel="Details ausblenden"
    />,
  );
  return { ...view, onToggleExpanded, onHeaderAction };
};

const card = (id: number): HTMLElement =>
  document.querySelector(`[data-mobile-card-id="${id}"]`) as HTMLElement;
const toggle = (id: number): HTMLElement =>
  within(card(id)).getByRole('button', { name: /Details (anzeigen|ausblenden)/ });

/**
 * The card list the planting-plan page shows instead of its grid on a phone.
 * It is the mobile half of a pair -- the grid is the desktop one -- so what
 * matters here is the things a phone needs and a grid does not: one large
 * touch target per card, a label that says what a tap will do, and secondary
 * actions that do not fire when the card itself is tapped.
 */
describe('MobileCardList', () => {
  describe('with nothing to show', () => {
    it('shows the caller’s empty state', () => {
      renderList({ items: [], emptyState: <p>Noch keine Anbaupläne.</p> });

      expect(screen.getByText('Noch keine Anbaupläne.')).toBeInTheDocument();
    });

    it('renders nothing at all when the caller offers no empty state', () => {
      const { container } = renderList({ items: [] });

      // Not an empty Stack taking vertical space above whatever follows.
      expect(container).toBeEmptyDOMElement();
    });

    it('shows no cards', () => {
      renderList({ items: [], emptyState: <p>Leer</p> });

      expect(screen.queryByRole('button', { name: /Details/ })).not.toBeInTheDocument();
    });
  });

  describe('the cards', () => {
    it('gives each item its own card, tagged with its id', () => {
      renderList();

      expect(card(1)).toBeInTheDocument();
      expect(card(2)).toBeInTheDocument();
    });

    it('shows the primary and secondary lines', () => {
      renderList();

      expect(within(card(1)).getByText('Karotte (Nantaise)')).toBeInTheDocument();
      expect(within(card(1)).getByText('Beet 1')).toBeInTheDocument();
    });

    it('leaves the secondary line out when the caller has none', () => {
      renderList({ withSecondary: false });

      expect(within(card(1)).getByText('Karotte (Nantaise)')).toBeInTheDocument();
      expect(within(card(1)).queryByText('Beet 1')).not.toBeInTheDocument();
    });
  });

  describe('expanding a card', () => {
    it('keeps the details out of reach while collapsed', () => {
      renderList();

      // MUI's Collapse keeps the node mounted, so "hidden" is the assertion
      // that matters rather than "absent".
      expect(screen.getByTestId('details-1')).not.toBeVisible();
    });

    it('shows them once expanded', () => {
      renderList({ expandedIds: new Set([1]) });

      expect(screen.getByTestId('details-1')).toBeVisible();
    });

    it('expands only the card that was tapped', async () => {
      const user = userEvent.setup();
      const { onToggleExpanded } = renderList();

      await user.click(toggle(2));

      expect(onToggleExpanded).toHaveBeenCalledWith(2);
      expect(onToggleExpanded).toHaveBeenCalledTimes(1);
    });

    it('lets several cards stand open at once', () => {
      // The caller owns a set rather than a single id, so comparing two
      // plans does not mean collapsing one to read the other.
      renderList({ expandedIds: new Set([1, 2]) });

      expect(screen.getByTestId('details-1')).toBeVisible();
      expect(screen.getByTestId('details-2')).toBeVisible();
    });

    it('reports its state, so a reader knows the card has more to it', () => {
      renderList({ expandedIds: new Set([1]) });

      expect(toggle(1)).toHaveAttribute('aria-expanded', 'true');
      expect(toggle(2)).toHaveAttribute('aria-expanded', 'false');
    });

    it('names what the next tap will do, not what the card is', () => {
      renderList({ expandedIds: new Set([1]) });

      // The card's own text is already announced; the button's name is the
      // only place the *action* can be heard.
      expect(within(card(1)).getByRole('button', { name: 'Details ausblenden' })).toBeInTheDocument();
      expect(within(card(2)).getByRole('button', { name: 'Details anzeigen' })).toBeInTheDocument();
    });

    it('keeps the chevron out of the announcement and turns it when open', () => {
      renderList({ expandedIds: new Set([1]) });

      // It duplicates what aria-expanded and the label already say, so it is
      // hidden from the reader -- and it is the rotation, not a second icon,
      // that shows the state to everyone else.
      const chevron = card(1).querySelector('svg')?.parentElement as HTMLElement;
      expect(chevron).toHaveAttribute('aria-hidden', 'true');
      expect(chevron).toHaveStyle({ transform: 'rotate(180deg)' });

      const collapsed = card(2).querySelector('svg')?.parentElement as HTMLElement;
      expect(collapsed).toHaveStyle({ transform: 'rotate(0deg)' });
    });

    it('offers a touch target tall enough to hit', () => {
      renderList();

      // 44px is the floor for a thumb; the whole header is one target
      // rather than a small chevron in the corner.
      expect(toggle(1)).toHaveStyle({ minHeight: '44px' });
    });

    it('spans the full card width, so there is no dead strip beside the title', () => {
      renderList();

      expect(toggle(1)).toHaveStyle({ width: '100%' });
    });
  });

  describe('the header action', () => {
    it('is offered beside the toggle when the caller has one', () => {
      renderList({ withHeaderAction: true });

      expect(
        within(card(1)).getByRole('button', { name: 'Menü Karotte (Nantaise)' }),
      ).toBeInTheDocument();
    });

    it('does not expand the card it belongs to', async () => {
      const user = userEvent.setup();
      const { onToggleExpanded, onHeaderAction } = renderList({ withHeaderAction: true });

      await user.click(within(card(1)).getByRole('button', { name: 'Menü Karotte (Nantaise)' }));

      // It sits outside the action area rather than inside it, so opening a
      // row menu does not also unfold the card underneath it.
      expect(onHeaderAction).toHaveBeenCalled();
      expect(onToggleExpanded).not.toHaveBeenCalled();
    });

    it('stays out of the way when the caller has none', () => {
      renderList();

      expect(within(card(1)).queryByRole('button', { name: /Menü/ })).not.toBeInTheDocument();
    });
  });

  describe('the optional slots', () => {
    it('hides the actions with the details they belong to', () => {
      renderList({ withActions: true });

      // They act on what the details show, so they appear with it.
      expect(screen.getByTestId('action-1')).not.toBeVisible();
    });

    it('shows the actions once the card is open', () => {
      renderList({ withActions: true, expandedIds: new Set([1]) });

      expect(screen.getByTestId('action-1')).toBeVisible();
    });

    it('keeps the footer visible whether the card is open or not', () => {
      renderList({ withFooter: true });

      // The footer carries a summary line -- an area, a count -- that is the
      // reason to open the card in the first place, so hiding it would
      // defeat the collapsed view.
      expect(screen.getByTestId('footer-1')).toBeVisible();
    });

    it('still shows the footer when the card is open', () => {
      renderList({ withFooter: true, expandedIds: new Set([1]) });

      expect(screen.getByTestId('footer-1')).toBeVisible();
    });

    it('leaves out every slot the caller does not fill', () => {
      renderList();

      expect(screen.queryByTestId('action-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('footer-1')).not.toBeInTheDocument();
    });
  });
});
