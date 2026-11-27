import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GridRenderCellParams } from '@mui/x-data-grid';
import { describe, expect, it, vi } from 'vitest';
import { renderNameCell } from '../components/hierarchy/hierarchyNameCell';
import type { HierarchyRow } from '../components/hierarchy/utils/types';
import type {
  HierarchyColumnOptions,
  NameCellCallbacks,
} from '../components/hierarchy/hierarchyColumnShared';
import i18n from '../i18n';
import { ParcelRotationContext } from '../components/hierarchy/rotation/parcelRotationContext';
import { createParcelRotationColumn } from '../components/hierarchy/rotation/parcelRotationColumn';

const t = i18n.getFixedT('de', 'hierarchy');

const row = (overrides: Partial<HierarchyRow> = {}): HierarchyRow => ({
  id: 'loc-1',
  type: 'location',
  level: 0,
  ...overrides,
});

const callbacks = (): NameCellCallbacks & { [K in keyof NameCellCallbacks]: ReturnType<typeof vi.fn> } => ({
  onToggleExpand: vi.fn(),
  onAddBed: vi.fn(),
  onDeleteBed: vi.fn(),
  onAddField: vi.fn(),
  onDeleteField: vi.fn(),
  onDeleteLocation: vi.fn(),
  onCreatePlantingPlan: vi.fn(),
  onOpenContextMenu: vi.fn(),
  onOpenContextMenuFromButton: vi.fn(),
}) as never;

interface RenderOptions {
  row?: HierarchyRow;
  value?: string;
  options?: HierarchyColumnOptions;
  /** A grid render passes an api; the mobile path renders standalone. */
  insideGrid?: boolean;
}

const renderCell = ({
  row: current = row(),
  value = 'Hof',
  options = {},
  insideGrid = true,
}: RenderOptions = {}) => {
  const spies = callbacks();
  const params = {
    row: current,
    value,
    ...(insideGrid ? { api: {} } : {}),
  } as unknown as GridRenderCellParams<HierarchyRow>;
  const view = render(<div>{renderNameCell(params, spies, t, options)}</div>);
  return { ...view, spies };
};

const slot = () => screen.getByTestId('expand-icon-slot');
const nameText = () => screen.getByTestId('hierarchy-name-text');

/**
 * The "Name" cell of the growing-areas grid: the tree's indentation, its
 * expand toggle, and the row's own actions. Its actions are covered in
 * `hierarchyRowActions.test.tsx`; what is covered here is the cell around
 * them -- how the tree reads as a tree, and which rows get which affordances.
 */
describe('renderNameCell', () => {
  describe('the tree shape', () => {
    it('leaves a top-level row flush', () => {
      renderCell({ row: row({ level: 0 }) });

      expect(nameText().closest('[class*="MuiBox"]')).toBeInTheDocument();
      expect(slot()).toHaveStyle({ marginLeft: '0px' });
    });

    it('indents each level by a fixed step', () => {
      renderCell({ row: row({ type: 'field', level: 1 }) });

      expect(slot()).toHaveStyle({ marginLeft: '24px' });
    });

    it('indents a third level twice as far', () => {
      renderCell({ row: row({ type: 'bed', level: 2 }) });

      expect(slot()).toHaveStyle({ marginLeft: '48px' });
    });

    it('reserves the toggle slot even where there is no toggle', () => {
      renderCell({ row: row({ type: 'bed', level: 2 }) });

      // Without the empty slot, a bed's name would sit 32px left of its
      // siblings' names and the tree would look ragged.
      expect(slot()).toBeInTheDocument();
      expect(slot()).toHaveStyle({ minWidth: '32px' });
    });

    it('keeps the placeholder chevron out of the way and out of the announcement', () => {
      renderCell({ row: row({ type: 'bed', level: 2 }) });

      const placeholder = slot().querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(placeholder).toHaveStyle({ visibility: 'hidden' });
      // The whole slot also stops taking pointer events, so the blank space
      // where a toggle would be is not a target that does nothing.
      expect(slot()).toHaveStyle({ pointerEvents: 'none' });
    });
  });

  describe('the expand toggle', () => {
    it('is offered to a location that has children', () => {
      renderCell({ row: row({ type: 'location', hasChildren: true }) });

      expect(
        within(slot()).getByRole('button', { name: 'Eintrag aufklappen' }),
      ).toBeInTheDocument();
    });

    it('is offered to a field that has children', () => {
      renderCell({ row: row({ type: 'field', level: 1, hasChildren: true }) });

      expect(
        within(slot()).getByRole('button', { name: 'Eintrag aufklappen' }),
      ).toBeInTheDocument();
    });

    it('is withheld from a row with nothing under it', () => {
      // A toggle that opens onto nothing is a control that does nothing.
      renderCell({ row: row({ type: 'location', hasChildren: false }) });

      expect(within(slot()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('is withheld from a bed, which is the end of the tree', () => {
      renderCell({ row: row({ type: 'bed', level: 2, hasChildren: true }) });

      expect(within(slot()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('says which way it will go', () => {
      renderCell({ row: row({ hasChildren: true, expanded: true }) });

      // The chevron's direction is the visual half; the label is what a
      // screen reader gets.
      expect(
        within(slot()).getByRole('button', { name: 'Eintrag zuklappen' }),
      ).toBeInTheDocument();
    });

    it('toggles the row it belongs to', async () => {
      const user = userEvent.setup();
      const { spies } = renderCell({
        row: row({ id: 'loc-7', hasChildren: true }),
      });

      await user.click(within(slot()).getByRole('button'));

      expect(spies.onToggleExpand).toHaveBeenCalledWith('loc-7');
    });

    it('stays out of the grid’s tab order', () => {
      renderCell({ row: row({ hasChildren: true }) });

      // The grid owns keyboard navigation; a tab stop per row would make
      // walking the tree with Tab take one press per toggle.
      expect(within(slot()).getByRole('button')).toHaveAttribute('tabindex', '-1');
    });

    it('does not let the click reach the row underneath', async () => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();
      const spies = callbacks();
      const params = {
        row: row({ hasChildren: true }),
        value: 'Hof',
        api: {},
      } as unknown as GridRenderCellParams<HierarchyRow>;
      render(
        <div onClick={onRowClick} role="presentation">
          {renderNameCell(params, spies, t, {})}
        </div>,
      );

      await user.click(screen.getByRole('button', { name: 'Eintrag aufklappen' }));

      // The whole row is clickable to select it, so without stopPropagation
      // every expand would also move the selection.
      expect(spies.onToggleExpand).toHaveBeenCalled();
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });

  describe('the name itself', () => {
    it('shows the cell value', () => {
      renderCell({ value: 'Hof Nord' });

      expect(screen.getByText('Hof Nord')).toBeInTheDocument();
    });

    it('survives a row with no name yet', () => {
      // A freshly added row has no value until it is typed.
      renderCell({ value: undefined as unknown as string });

      expect(nameText()).toBeInTheDocument();
    });

    it('sets a location apart by weight', () => {
      renderCell({ row: row({ type: 'location' }), value: 'Hof' });

      // Three row types in one flat grid; weight and size are what make the
      // levels readable at a glance.
      expect(nameText()).toHaveStyle({ fontWeight: '600' });
    });

    it('leaves a field and a bed at normal weight', () => {
      renderCell({ row: row({ type: 'field', level: 1 }), value: 'Parzelle A' });

      expect(nameText()).toHaveStyle({ fontWeight: '400' });
    });

    it('opens the row’s context menu from the name area', async () => {
      const { spies } = renderCell({ row: row({ id: 'loc-3' }) });

      await userEvent.setup().pointer({
        keys: '[MouseRight]',
        target: nameText(),
      });

      expect(spies.onOpenContextMenu).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'loc-3' }),
      );
    });
  });

  describe('the persistent actions button', () => {
    const overlay = () => screen.getByTestId('hierarchy-name-actions-overlay');
    const actions = () => within(overlay()).getByRole('button', { name: 'Aktionen' });

    it('stays away unless the caller asks for it', () => {
      renderCell({ row: row({ type: 'location' }) });

      expect(overlay()).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
    });

    it('is offered when the caller asks, for a row that has a menu', () => {
      renderCell({
        row: row({ type: 'location' }),
        options: { showPersistentContextMenuButton: true },
      });

      expect(overlay()).toHaveStyle({ position: 'absolute', opacity: '1', pointerEvents: 'auto' });
      expect(within(overlay()).getAllByRole('button')).toEqual([actions()]);
    });

    it.each(['location', 'field', 'bed', 'individualPlan'] as const)('is offered on a %s row', (type) => {
      renderCell({
        row: row({ type }),
        options: { showPersistentContextMenuButton: true },
      });
      expect(actions()).toBeVisible();
    });

    it('is large enough to hit, unlike the hover-revealed one', () => {
      renderCell({
        row: row({ type: 'location' }),
        options: { showPersistentContextMenuButton: true },
      });

      // This is the variant the touch layouts turn on, so it carries a
      // 40px target rather than the compact hover icon's.
      expect(actions()).toHaveStyle({ width: '40px', height: '40px' });
    });
  });

  describe('the inline actions overlay', () => {
    it('is revealed on hover inside the grid', () => {
      renderCell({ row: row({ type: 'location' }), insideGrid: true });

      const overlay = screen.getByTestId('hierarchy-name-actions-overlay');
      expect(overlay).toHaveStyle({ opacity: '0' });
    });

    it('is always visible where there is no hover to rely on', () => {
      // A standalone render is the mobile path: no pointer, so a
      // hover-gated overlay would be unreachable.
      renderCell({ row: row({ type: 'location' }), insideGrid: false });

      const overlay = screen.getByTestId('hierarchy-name-actions-overlay');
      expect(overlay).toHaveStyle({ opacity: '1', pointerEvents: 'auto' });
    });
  });

  describe('the rotation group (#1576)', () => {
    const memberships = new Map([[7, { group: 'Nord–Süd', position: 2, size: 3 }]]);

    it('is no longer shown as a badge beside an assigned parcel name', () => {
      const params = { row: row({ id: 'field-7', type: 'field', fieldId: 7, level: 1 }), value: 'Nord', api: {} };
      render(
        <ParcelRotationContext.Provider value={{ memberships }}>
          {renderNameCell(params as unknown as GridRenderCellParams<HierarchyRow>, callbacks(), t, {})}
        </ParcelRotationContext.Provider>,
      );

      expect(screen.queryByText(/Nord–Süd/)).not.toBeInTheDocument();
      expect(screen.queryByRole('img', { name: /Rotationsgruppe/ })).not.toBeInTheDocument();
      expect(nameText()).toHaveTextContent('Nord');
    });

    it('fills the optional column only for assigned parcels', () => {
      const column = createParcelRotationColumn(t, memberships);
      const value = (current: HierarchyRow) => (column.valueGetter as (v: unknown, r: HierarchyRow) => string)(
        undefined, current,
      );

      expect(column).toMatchObject({ field: 'rotation_group', headerName: 'Rotationsgruppe', editable: false });
      expect(value(row({ type: 'field', fieldId: 7 }))).toBe('Nord–Süd · 2/3');
      expect(value(row({ type: 'field', fieldId: 8 }))).toBe('');
      expect(value(row({ type: 'location', locationId: 7 }))).toBe('');
      expect(value(row({ type: 'bed', bedId: 7, fieldId: 7 }))).toBe('');
    });

    it.each(['loading', 'error'] as const)('never shows a parcel as unassigned while the groups are %s', (status) => {
      const column = createParcelRotationColumn(t, memberships, status);
      const parcel = row({ id: 'field-7', type: 'field', fieldId: 7 });
      const value = (column.valueGetter as (v: unknown, r: HierarchyRow) => string)(undefined, parcel);
      render(<div>{column.renderCell?.({ row: parcel, value } as never)}</div>);

      if (status === 'loading') {
        expect(screen.getByRole('progressbar', { name: 'Lädt...' })).toBeInTheDocument();
      } else {
        expect(screen.getByRole('img', { name: 'Die Rotationsgruppen konnten nicht geladen werden.' })).toBeInTheDocument();
      }
      expect(screen.queryByTestId('parcel-rotation-cell')).not.toBeInTheDocument();
    });
  });
});
