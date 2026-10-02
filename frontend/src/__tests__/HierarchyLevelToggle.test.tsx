import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HierarchyLevelButtons } from '../components/hierarchy/HierarchyLevelToggle';

const EXPAND_LABEL = 'Eine Hierarchieebene mehr anzeigen';
const COLLAPSE_LABEL = 'Eine Hierarchieebene ausblenden';

interface RenderOptions {
  canExpand?: boolean;
  canCollapse?: boolean;
  onHeaderClick?: () => void;
}

const renderButtons = ({
  canExpand = true,
  canCollapse = true,
  onHeaderClick,
}: RenderOptions = {}) => {
  const onExpandOneLevel = vi.fn();
  const onCollapseOneLevel = vi.fn();
  const buttons = (
    <HierarchyLevelButtons
      canExpand={canExpand}
      canCollapse={canCollapse}
      onExpandOneLevel={onExpandOneLevel}
      onCollapseOneLevel={onCollapseOneLevel}
    />
  );
  const view = render(
    onHeaderClick ? (
      <div onClick={onHeaderClick} role="presentation">
        {buttons}
      </div>
    ) : (
      buttons
    ),
  );
  return { ...view, onExpandOneLevel, onCollapseOneLevel };
};

const expandButton = (): HTMLElement => screen.getByRole('button', { name: EXPAND_LABEL });
const collapseButton = (): HTMLElement => screen.getByRole('button', { name: COLLAPSE_LABEL });

/**
 * The expand/collapse-one-level pair embedded in the Anbauflächen and
 * Anbaukalender tree headers. It steps relative to the tree's current state --
 * `useHierarchyLevelToggle` owns that state and works out `canExpand` /
 * `canCollapse`, and has its own tests -- so what is covered here is the part
 * the two host headers depend on: that each button is reachable and labelled
 * for a screen reader even while disabled, that it calls the step it is named
 * after, and that a click on it does not also reach the column header it sits
 * inside.
 */
describe('HierarchyLevelButtons', () => {
  describe('stepping', () => {
    it('expands one level', async () => {
      const user = userEvent.setup();
      const { onExpandOneLevel, onCollapseOneLevel } = renderButtons();
      await user.click(expandButton());
      expect(onExpandOneLevel).toHaveBeenCalledTimes(1);
      expect(onCollapseOneLevel).not.toHaveBeenCalled();
    });

    it('collapses one level', async () => {
      const user = userEvent.setup();
      const { onExpandOneLevel, onCollapseOneLevel } = renderButtons();
      await user.click(collapseButton());
      expect(onCollapseOneLevel).toHaveBeenCalledTimes(1);
      expect(onExpandOneLevel).not.toHaveBeenCalled();
    });

    it('steps once per click, so holding a level is the caller\'s business', async () => {
      const user = userEvent.setup();
      const { onExpandOneLevel } = renderButtons();
      await user.click(expandButton());
      await user.click(expandButton());
      expect(onExpandOneLevel).toHaveBeenCalledTimes(2);
    });
  });

  describe('what the tree allows', () => {
    it('disables expanding once the tree is fully open', () => {
      renderButtons({ canExpand: false, canCollapse: true });
      expect(expandButton()).toBeDisabled();
      expect(collapseButton()).toBeEnabled();
    });

    it('disables collapsing once the tree is fully closed', () => {
      renderButtons({ canExpand: true, canCollapse: false });
      expect(collapseButton()).toBeDisabled();
      expect(expandButton()).toBeEnabled();
    });

    /** A two-level project with one location can be neither stepped nor folded. */
    it('disables both when there is nothing to step', () => {
      renderButtons({ canExpand: false, canCollapse: false });
      expect(expandButton()).toBeDisabled();
      expect(collapseButton()).toBeDisabled();
    });

    /**
     * `fireEvent` rather than `userEvent`: a disabled MUI button has
     * `pointer-events: none`, so userEvent rightly refuses to click it, and the
     * point here is that even a click that does reach the element steps nothing.
     */
    it('steps nothing while disabled', () => {
      const { onExpandOneLevel, onCollapseOneLevel } = renderButtons({
        canExpand: false,
        canCollapse: false,
      });
      fireEvent.click(expandButton());
      fireEvent.click(collapseButton());
      expect(onExpandOneLevel).not.toHaveBeenCalled();
      expect(onCollapseOneLevel).not.toHaveBeenCalled();
    });
  });

  describe('being findable', () => {
    /**
     * The buttons carry only an icon, so the accessible name has to come from
     * `aria-label` -- and it has to survive being disabled, which is the state
     * a screen-reader user most needs explained.
     */
    it('names both buttons in German', () => {
      renderButtons();
      expect(expandButton()).toBeInTheDocument();
      expect(collapseButton()).toBeInTheDocument();
    });

    it('keeps the names while disabled', () => {
      renderButtons({ canExpand: false, canCollapse: false });
      expect(expandButton()).toBeInTheDocument();
      expect(collapseButton()).toBeInTheDocument();
    });

    /**
     * The icon is the only thing on the button, so a swapped pair would show a
     * "+" on the control that folds the tree -- invisible to every
     * label-and-handler assertion above.
     */
    it('draws a minus on collapse and a plus on expand', () => {
      const { container } = renderButtons();
      expect(collapseButton().querySelector('[data-testid="RemoveIcon"]')).toBeInTheDocument();
      expect(expandButton().querySelector('[data-testid="AddIcon"]')).toBeInTheDocument();
      expect(container.querySelectorAll('[data-testid="RemoveIcon"]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-testid="AddIcon"]')).toHaveLength(1);
    });

    it('puts collapse before expand, matching the "−" then "+" reading order', () => {
      renderButtons();
      const [first, second] = screen.getAllByRole('button');
      expect(first).toHaveAccessibleName(COLLAPSE_LABEL);
      expect(second).toHaveAccessibleName(EXPAND_LABEL);
    });

    /**
     * One hover per test, and the tooltip is found by role: `AppTooltip` is not
     * `describeChild` here (the buttons carry their own `aria-label`), so there
     * is no `aria-describedby` tying a popper to its control -- which means a
     * second hover in the same test could read the first tooltip while it is
     * still closing.
     */
    it.each([
      ['the collapse button', () => collapseButton(), COLLAPSE_LABEL],
      ['the expand button', () => expandButton(), EXPAND_LABEL],
    ])('explains %s on hover', async (_label, button, expected) => {
      const user = userEvent.setup();
      renderButtons();
      await user.hover(button().parentElement as HTMLElement);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(expected);
    });

    /**
     * The tooltip wrapper is a plain `span` around the button rather than the
     * button itself, so the explanation is still reachable once the button stops
     * emitting pointer events -- which is exactly when the user wants it.
     */
    it('explains a disabled button too', async () => {
      const user = userEvent.setup();
      renderButtons({ canExpand: false, canCollapse: false });
      await user.hover(expandButton().parentElement as HTMLElement);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(EXPAND_LABEL);
    });
  });

  describe('sitting inside a sortable column header', () => {
    /**
     * In `FieldsBedsHierarchy` these live inside the "Name" header, whose own
     * click toggles the sort. Without the wrapper's `stopPropagation`, stepping
     * a level would re-sort the table underneath the user.
     */
    it('keeps a click from reaching the header', async () => {
      const user = userEvent.setup();
      const onHeaderClick = vi.fn();
      const { onExpandOneLevel } = renderButtons({ onHeaderClick });
      await user.click(expandButton());
      expect(onExpandOneLevel).toHaveBeenCalledTimes(1);
      expect(onHeaderClick).not.toHaveBeenCalled();
    });

    it('keeps a click on the gap between them from reaching the header either', async () => {
      const user = userEvent.setup();
      const onHeaderClick = vi.fn();
      const { container } = renderButtons({ onHeaderClick });
      const wrapper = container.querySelector('[role="presentation"] > div') as HTMLElement;
      await user.click(wrapper);
      expect(onHeaderClick).not.toHaveBeenCalled();
    });

    it('still lets the header handle clicks beside the buttons', async () => {
      const user = userEvent.setup();
      const onHeaderClick = vi.fn();
      const { container } = renderButtons({ onHeaderClick });
      await user.click(container.querySelector('[role="presentation"]') as HTMLElement);
      expect(onHeaderClick).toHaveBeenCalledTimes(1);
    });

    it('does not shrink when the header runs out of room', () => {
      const { container } = renderButtons();
      const wrapper = container.firstElementChild as HTMLElement;
      expect(window.getComputedStyle(wrapper).flexShrink).toBe('0');
    });
  });
});
