import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '../i18n/config';
import type { HierarchyRow } from '../components/hierarchy/utils/types';
import type {
  HierarchyColumnOptions,
  NameCellCallbacks,
} from '../components/hierarchy/hierarchyColumnShared';
import {
  renderInlineActions,
  renderMoreActionsButton,
} from '../components/hierarchy/hierarchyRowActions';

/**
 * The real German bundle: the three row types offer different actions whose
 * only visible difference is the label, so a passthrough `t` would let the
 * "Parzelle" and "Beet" add-buttons be swapped without a test noticing.
 */
const t = i18n.getFixedT('de') as TFunction;

const callbacks = (): NameCellCallbacks => ({
  onToggleExpand: vi.fn(),
  onAddBed: vi.fn(),
  onDeleteBed: vi.fn(),
  onAddField: vi.fn(),
  onDeleteField: vi.fn(),
  onDeleteLocation: vi.fn(),
  onCreatePlantingPlan: vi.fn(),
  onOpenContextMenu: vi.fn(),
  onOpenContextMenuFromButton: vi.fn(),
});

const location = (overrides: Partial<HierarchyRow> = {}): HierarchyRow => ({
  id: 'location-1', type: 'location', level: 0, name: 'Hofacker', locationId: 1, ...overrides,
});

const field = (overrides: Partial<HierarchyRow> = {}): HierarchyRow => ({
  id: 'field-1', type: 'field', level: 1, name: 'Parzelle A', fieldId: 2, ...overrides,
});

const bed = (overrides: Partial<HierarchyRow> = {}): HierarchyRow => ({
  id: 3, type: 'bed', level: 2, name: 'Beet 1', bedId: 3, ...overrides,
});

/**
 * The actions sit inside a clickable row, so every one of them is rendered
 * inside a row-level click handler here -- stopping propagation is part of
 * what they do, and a bare render could not show it.
 */
const setup = (
  row: HierarchyRow,
  { options = {}, isStandalone = false }: {
    options?: HierarchyColumnOptions;
    isStandalone?: boolean;
  } = {},
) => {
  const spies = callbacks();
  const onRowClick = vi.fn();
  const view = render(
    <div onClick={onRowClick} role="presentation">
      {renderInlineActions(row, spies, t, options, isStandalone)}
    </div>,
  );
  return { ...view, ...spies, onRowClick };
};

const button = (name: string) => screen.getByRole('button', { name });
const buttonNames = () => screen.getAllByRole('button').map((element) => element.getAttribute('aria-label'));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a location row', () => {
  it('offers adding a field, deleting, and the overflow menu', () => {
    setup(location());

    expect(buttonNames()).toEqual(['Parzelle', 'Löschen', 'Aktionen']);
  });

  it('adds a field to that location', async () => {
    const user = userEvent.setup();
    const { onAddField } = setup(location());

    await user.click(button('Parzelle'));

    expect(onAddField).toHaveBeenCalledWith(1);
  });

  it('deletes that location', async () => {
    const user = userEvent.setup();
    const { onDeleteLocation, onDeleteField, onDeleteBed } = setup(location());

    await user.click(button('Löschen'));

    expect(onDeleteLocation).toHaveBeenCalledWith(1);
    expect(onDeleteField).not.toHaveBeenCalled();
    expect(onDeleteBed).not.toHaveBeenCalled();
  });

  it('offers no delete for a location with no id', () => {
    // A row still being created has no id to delete by. The child count is
    // asserted too: the actions sit in a flex row with a gap, so an empty
    // placeholder left where the delete would be still takes up space.
    const { container } = setup(location({ locationId: undefined }));

    expect(buttonNames()).toEqual(['Parzelle', 'Aktionen']);
    expect(container.querySelector('.action-icons')?.children).toHaveLength(2);
  });

  it('still offers adding a field without an id', () => {
    // The callback takes an optional id: adding to an unsaved location is
    // how the first field of a new one is created.
    setup(location({ locationId: undefined }));

    expect(button('Parzelle')).toBeInTheDocument();
  });
});

describe('a field row', () => {
  it('offers adding a bed, deleting, and the overflow menu', () => {
    setup(field());

    expect(buttonNames()).toEqual(['Beet für diese Parzelle hinzufügen', 'Löschen', 'Aktionen']);
  });

  it('adds a bed to that field', async () => {
    const user = userEvent.setup();
    const { onAddBed } = setup(field());

    await user.click(button('Beet für diese Parzelle hinzufügen'));

    expect(onAddBed).toHaveBeenCalledWith(2);
  });

  it('deletes that field', async () => {
    const user = userEvent.setup();
    const { onDeleteField, onDeleteLocation, onDeleteBed } = setup(field());

    await user.click(button('Löschen'));

    expect(onDeleteField).toHaveBeenCalledWith(2);
    expect(onDeleteLocation).not.toHaveBeenCalled();
    expect(onDeleteBed).not.toHaveBeenCalled();
  });

  it('offers no delete for a field with no id', () => {
    setup(field({ fieldId: undefined }));

    expect(buttonNames()).toEqual(['Beet für diese Parzelle hinzufügen', 'Aktionen']);
  });
});

describe('a bed row', () => {
  it('offers a planting plan, deleting, and the overflow menu', () => {
    // A bed is the end of the hierarchy, so instead of adding a child it
    // offers the thing a bed is for.
    setup(bed());

    expect(buttonNames()).toEqual(['Anbauplan hinzufügen', 'Löschen', 'Aktionen']);
  });

  it('names the planting-plan action in its tooltip too', async () => {
    // The tooltip text and the accessible name are set from separate
    // arguments, so one can be wrong while the other is right -- and the
    // tooltip is what a mouse user actually reads.
    const user = userEvent.setup();
    setup(bed());

    await user.hover(button('Anbauplan hinzufügen'));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Anbauplan hinzufügen');
  });

  it('renders the plan action only because the bed branch asks for it', () => {
    // The helper also checks the row type itself, which cannot change the
    // answer: it is called from the bed branch alone, so by the time it runs
    // the type is already known. Documented rather than given a fixture with
    // a location row carrying a stray bed id.
    setup(field({ fieldId: 2 }));

    expect(screen.queryByRole('button', { name: 'Anbauplan hinzufügen' })).not.toBeInTheDocument();
  });

  it('creates a planting plan for that bed', async () => {
    const user = userEvent.setup();
    const { onCreatePlantingPlan } = setup(bed());

    await user.click(button('Anbauplan hinzufügen'));

    expect(onCreatePlantingPlan).toHaveBeenCalledWith(3);
  });

  it('deletes that bed', async () => {
    const user = userEvent.setup();
    const { onDeleteBed, onDeleteLocation, onDeleteField } = setup(bed());

    await user.click(button('Löschen'));

    expect(onDeleteBed).toHaveBeenCalledWith(3);
    expect(onDeleteLocation).not.toHaveBeenCalled();
    expect(onDeleteField).not.toHaveBeenCalled();
  });

  it('offers neither a plan nor a delete for a bed with no id', () => {
    setup(bed({ bedId: undefined }));

    expect(buttonNames()).toEqual(['Aktionen']);
  });
});

describe('not competing with the row itself', () => {
  it.each([
    ['location', location(), 'Parzelle'],
    ['location delete', location(), 'Löschen'],
    ['field', field(), 'Beet für diese Parzelle hinzufügen'],
    ['bed plan', bed(), 'Anbauplan hinzufügen'],
    ['bed delete', bed(), 'Löschen'],
  ])('%s does not also trigger the row', async (_label, row, name) => {
    // The whole row is clickable to select it. Without stopping propagation
    // every action would also move the selection underneath the dialog it
    // just opened.
    const user = userEvent.setup();
    const { onRowClick } = setup(row, {});

    await user.click(button(name));

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it.each([
    ['location', location()],
    ['field', field()],
    ['bed', bed()],
  ])('none of a %s row\'s actions is a tab stop', (_label, row) => {
    // The tree is navigated by arrow keys with one tab stop for the table;
    // three actions per row would put hundreds of stops in a long list.
    // Checked per row type because the add control on a location and a field
    // is a different component from the bed's planting-plan button.
    setup(row);

    expect(screen.getAllByRole('button').map((element) => element.tabIndex))
      .toEqual([-1, -1, -1]);
  });
});

describe('the overflow menu button', () => {
  it('opens the context menu for its own row', async () => {
    // Rendered standalone, because in the inline case the indicator starts
    // hidden and click-through until the row is hovered -- userEvent refuses
    // to click an element with pointer-events none, which is the next test.
    const user = userEvent.setup();
    const row = bed();
    const { onOpenContextMenu } = setup(row, { isStandalone: true });

    await user.click(button('Aktionen'));

    expect(onOpenContextMenu).toHaveBeenCalledWith(expect.anything(), row);
  });

  it('is hidden and click-through until the row is hovered', () => {
    // The inline actions are a hover affordance: showing three icons on
    // every row of a long tree would be noise, and leaving them clickable
    // while invisible would make the row a minefield.
    setup(bed());

    expect(button('Aktionen')).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
  });

  it.each([
    ['location', location({ locationId: undefined })],
    ['field', field({ fieldId: undefined })],
    ['bed', bed({ bedId: undefined })],
  ])('is offered on a %s row even when it offers nothing else', (_label, row) => {
    // It is the only way to reach the full action list, so no row may be
    // without it.
    setup(row);

    expect(button('Aktionen')).toBeInTheDocument();
  });
});

describe('when the row renders its actions on its own', () => {
  it('keeps the overflow button visible and clickable rather than hover-only', () => {
    // Rendered outside the hover group -- on mobile, where there is no hover
    // to reveal it -- it has to stay visible and usable by itself.
    const spies = callbacks();
    render(<div>{renderMoreActionsButton(bed(), spies, t, true)}</div>);

    expect(button('Aktionen')).toHaveStyle({ opacity: '1', pointerEvents: 'auto' });
  });

  it('lets the caller override that with its own style', () => {
    // The compact layouts position it differently, so the standalone default
    // is a fallback rather than something the caller has to fight.
    const spies = callbacks();
    render(<div>{renderMoreActionsButton(bed(), spies, t, true, { opacity: 0.5 })}</div>);

    expect(button('Aktionen')).toHaveStyle({ opacity: '0.5' });
  });

  it('keeps the hover behaviour when it is not standalone', () => {
    const spies = callbacks();
    render(<div>{renderMoreActionsButton(bed(), spies, t, false)}</div>);

    expect(button('Aktionen')).toHaveStyle({ opacity: '0' });
  });
});

describe('when inline actions are switched off', () => {
  it.each([
    ['location', location()],
    ['field', field()],
    ['bed', bed()],
  ])('renders nothing for a %s row', (_label, row) => {
    // The compact and mobile layouts reach the same actions through the row
    // context menu instead.
    setup(row, { options: { disableInlineHoverActions: true } });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('a row type the tree does not have', () => {
  it('renders nothing at all', () => {
    // Asserted as an empty container rather than an absence of buttons: a
    // stray wrapper with no controls in it would pass the button check while
    // still putting a gap in the row.
    const { container } = setup({ id: 'x', type: 'unknown', level: 0 } as unknown as HierarchyRow);

    expect(container.firstElementChild).toBeEmptyDOMElement();
  });
});
