import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createHierarchyColumns } from '../components/hierarchy/HierarchyColumns';
import { HierarchyFooter } from '../components/hierarchy/HierarchyFooter';
import { buildHierarchyRows } from '../components/hierarchy/utils/hierarchyUtils';
import { createBed, createField, createLocation } from './helpers/factories';
import { mockT } from './helpers/testI18n';
import { TruncatedTextWithTooltip } from '../components/TruncatedTextWithTooltip';

vi.mock('../i18n', () => ({
  useTranslation: () => ({ t: mockT }),
}));

type ElementWithSx = ReactElement<{
  children?: ReactNode;
  'data-testid'?: string;
  sx?: Record<string, unknown>;
  text?: string;
}>;

const findElementByTestId = (node: ReactNode, testId: string): ElementWithSx | null => {
  if (!isValidElement(node)) {
    return null;
  }

  const element = node as ElementWithSx;
  if (element.props['data-testid'] === testId) {
    return element;
  }

  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  for (const childNode of childNodes) {
    const match = findElementByTestId(childNode, testId);
    if (match) {
      return match;
    }
  }

  return null;
};

function mockFinePointer(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
}

function mockElementOverflow(element: HTMLElement, sizes: { clientWidth: number; scrollWidth: number }): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: sizes.clientWidth });
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: sizes.scrollWidth });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 20 });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 20 });
}

describe('hierarchy components and behaviors', () => {
  it('renders nested rows, handles duplicate labels and deep nesting expansion states', () => {
    const locations = [createLocation({ id: 1, name: 'Standort' })];
    const fields = [
      createField({ id: 11, location: 1, name: 'Duplikat' }),
      createField({ id: 12, location: 1, name: 'Duplikat' }),
    ];
    const beds = [
      createBed({ id: 101, field: 11, name: 'Ebene Tief 1' }),
      createBed({ id: 102, field: 12, name: 'Ebene Tief 2' }),
    ];

    const rows = buildHierarchyRows(locations, fields, beds, new Set(['field-11', 'field-12']));

    expect(rows.filter((row) => row.type === 'field')).toHaveLength(2);
    expect(rows.filter((row) => row.name === 'Duplikat')).toHaveLength(2);
    expect(rows.filter((row) => row.type === 'bed')).toHaveLength(2);
  });

  it('handles empty and single-node tree edge cases', () => {
    expect(buildHierarchyRows([], [], [], new Set())).toEqual([]);

    const rows = buildHierarchyRows([createLocation({ id: 5 })], [], [], new Set());
    expect(rows).toHaveLength(0);
  });

  it('marks expandability only for rows with real children', () => {
    const locations = [createLocation({ id: 1, name: 'A' }), createLocation({ id: 2, name: 'B' })];
    const fields = [createField({ id: 10, location: 1, name: 'Field 10' })];
    const beds = [createBed({ id: 100, field: 10, name: 'Bed 100' })];

    const rows = buildHierarchyRows(locations, fields, beds, new Set(['location-1', 'field-10', 'location-2']));

    const locationWithChildren = rows.find((row) => row.id === 'location-1');
    const fieldWithChildren = rows.find((row) => row.id === 'field-10');
    const bedLeaf = rows.find((row) => row.id === 100);

    expect(locationWithChildren?.hasChildren).toBe(true);
    expect(fieldWithChildren?.hasChildren).toBe(true);
    expect(bedLeaf?.hasChildren).toBe(false);
  });

  it('builds hierarchy inline add callbacks and shared menu triggers for rows', async () => {
    const user = userEvent.setup();
    const toggleExpand = vi.fn();
    const addBed = vi.fn();
    const deleteBed = vi.fn();
    const addField = vi.fn();
    const deleteField = vi.fn();
    const deleteLocation = vi.fn();
    const createPlan = vi.fn();
    const openContextMenu = vi.fn();
    const openNotes = vi.fn();

    const columns = createHierarchyColumns(
      toggleExpand,
      addBed,
      deleteBed,
      addField,
      deleteField,
      deleteLocation,
      createPlan,
      openContextMenu,
      openNotes,
      mockT as never,
    );

    const notesColumn = columns.find((column) => column.field === 'notes');
    const nameColumn = columns.find((column) => column.field === 'name');
    const areaColumn = columns.find((column) => column.field === 'area_sqm');

    expect(nameColumn?.width).toBe(280);
    expect(nameColumn).not.toHaveProperty('flex');
    expect(areaColumn?.width).toBe(120);
    // Notes column default was intentionally reduced to tighten content-fit hierarchy tables.
    expect(notesColumn?.width).toBe(220);
    expect(notesColumn?.minWidth).toBe(220);
    expect(notesColumn?.flex).toBe(1);
    expect(notesColumn).not.toHaveProperty('maxWidth');

    const { rerender } = render(
      <>
        {notesColumn?.renderCell?.({
          id: 'field-10',
          value: 'Notiz **fett**',
          row: { id: 'field-10', type: 'field', level: 1 },
        } as never)}
      </>
    );
    await user.click(screen.getByText('Notiz fett'));
    expect(openNotes).toHaveBeenCalledWith('field-10', 'notes');

    rerender(
      <>
        {nameColumn?.renderCell?.({
          id: 'location-2',
          field: 'name',
          value: 'Standort 2',
          row: { id: 'location-2', type: 'location', locationId: 2, level: 0, expanded: true },
        } as never)}
      </>
    );
    const addFieldButton = screen.getAllByLabelText('Parzelle hinzufügen')
      .find((button) => !button.hasAttribute('data-mui-internal-clone-element'));
    expect(addFieldButton).toBeDefined();
    expect(screen.queryByLabelText('Pflanzplan erstellen')).not.toBeInTheDocument();
    await user.click(addFieldButton!);
    expect(addField).toHaveBeenCalledWith(2);

    rerender(
      <>
        {nameColumn?.renderCell?.({
          id: 'field-10',
          field: 'name',
          value: 'Parzelle 10',
          row: { id: 'field-10', type: 'field', fieldId: 10, level: 1, expanded: true },
        } as never)}
      </>
    );
    const addBedButton = screen.getAllByRole('button', { name: 'Beet zu dieser Parzelle hinzufügen' })
      .find((button) => !button.hasAttribute('data-mui-internal-clone-element'));
    expect(addBedButton).toBeDefined();
    expect(screen.queryByLabelText('Pflanzplan erstellen')).not.toBeInTheDocument();
    await user.click(addBedButton!);
    expect(addBed).toHaveBeenCalledWith(10);
    const deleteFieldButton = screen.getAllByRole('button', { name: 'Löschen' })[0];
    const fieldActionsButton = screen.getAllByRole('button', { name: 'Aktionen' })[0];
    expect(deleteFieldButton).toBeDefined();
    expect(fieldActionsButton).toBeDefined();
    await user.click(fieldActionsButton!);
    expect(openContextMenu).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ id: 'field-10' }));
    expect(deleteField).not.toHaveBeenCalled();
    await user.click(deleteFieldButton!);
    expect(deleteField).toHaveBeenCalledWith(10);

    rerender(
      <>
        {nameColumn?.renderCell?.({
          id: 100,
          field: 'name',
          value: 'Beet 100',
          row: { id: 100, type: 'bed', bedId: 100, level: 2 },
        } as never)}
      </>
    );
    const createPlantingPlanButton = screen.getByRole('button', { name: 'Pflanzplan erstellen' });
    await user.click(createPlantingPlanButton);
    expect(createPlan).toHaveBeenCalledWith(100);
    const deleteBedButton = screen.getAllByRole('button', { name: 'Löschen' })[0];
    const bedActionsButton = screen.getAllByRole('button', { name: 'Aktionen' })[0];
    expect(deleteBedButton).toBeDefined();
    expect(bedActionsButton).toBeDefined();
    await user.click(bedActionsButton!);
    expect(openContextMenu).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ id: 100 }));
    expect(deleteBed).not.toHaveBeenCalled();
    await user.click(deleteBedButton!);
    expect(deleteBed).toHaveBeenCalledWith(100);

    const touchColumns = createHierarchyColumns(
      toggleExpand,
      addBed,
      deleteBed,
      addField,
      deleteField,
      deleteLocation,
      createPlan,
      openContextMenu,
      openNotes,
      mockT as never,
      undefined,
      { disableInlineHoverActions: true },
    );
    const touchNameColumn = touchColumns.find((column) => column.field === 'name');
    rerender(
      <>
        {touchNameColumn?.renderCell?.({
          id: 101,
          field: 'name',
          value: 'Beet 101',
          row: { id: 101, type: 'bed', bedId: 101, level: 2 },
        } as never)}
      </>
    );
    expect(screen.queryByLabelText('Pflanzplan erstellen')).not.toBeInTheDocument();

    rerender(
      <>
        {touchNameColumn?.renderCell?.({
          id: 'field-10',
          field: 'name',
          value: 'Parzelle 10',
          row: { id: 'field-10', type: 'field', fieldId: 10, level: 1 },
        } as never)}
      </>
    );
    expect(screen.queryByLabelText('Beet hinzufügen')).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('hierarchy-name-text'));
    expect(openContextMenu).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ id: 'field-10' }));
  }, 15000);

  it('renders a persistent mobile context menu button inside the name cell without triggering row clicks', async () => {
    const user = userEvent.setup();
    const openContextMenu = vi.fn();
    const rowClick = vi.fn();
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      openContextMenu,
      vi.fn(),
      mockT as never,
      undefined,
      {
        disableInlineHoverActions: true,
        showPersistentContextMenuButton: true,
      },
    );
    const nameColumn = columns.find((column) => column.field === 'name');

    render(
      <div role="presentation" onClick={rowClick}>
        {nameColumn?.renderCell?.({
          id: 'field-10',
          field: 'name',
          value: 'A very long parcel name with many name parts',
          row: { id: 'field-10', type: 'field', fieldId: 10, level: 2 },
        } as never)}
      </div>,
    );

    expect(screen.queryByLabelText('Beet zu dieser Parzelle hinzufügen')).not.toBeInTheDocument();
    const actionsButton = screen.getByRole('button', { name: 'Aktionen' });
    expect(actionsButton).toBeVisible();

    await user.click(actionsButton);

    expect(openContextMenu).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ id: 'field-10' }));
    expect(rowClick).not.toHaveBeenCalled();
  });



  it('applies custom hierarchy column widths when provided', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
      {
        name: 333,
        notes: 280,
      },
    );

    const nameColumn = columns.find((column) => column.field === 'name');
    const areaColumn = columns.find((column) => column.field === 'area_sqm');
    const notesColumn = columns.find((column) => column.field === 'notes');

    expect(nameColumn?.width).toBe(333);
    expect(areaColumn?.width).toBe(120);
    expect(notesColumn?.width).toBe(280);
  });

  it('renders hover actions for empty existing row names', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );

    const nameColumn = columns.find((column) => column.field === 'name');

    const renderedCell = nameColumn?.renderCell?.({
      id: 100,
      field: 'name',
      value: '',
      api: {},
      cellMode: 'view',
      row: { id: 100, type: 'bed', bedId: 100, name: '', level: 2 },
    } as never);

    const actionOverlay = findElementByTestId(renderedCell, 'hierarchy-name-actions-overlay');

    render(<>{renderedCell}</>);

    expect(actionOverlay?.props.sx).toMatchObject({
      position: 'absolute',
      right: 0,
      '@media (hover: hover)': {
        '.MuiDataGrid-row:hover &': {
          opacity: 1,
          pointerEvents: 'auto',
        },
      },
      '.MuiDataGrid-row--editing:hover &': {
        opacity: 0,
        pointerEvents: 'none',
      },
    });
    expect(screen.getByRole('button', { name: 'Aktionen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('renders hover actions for empty unsaved row names even in edit mode', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );

    const nameColumn = columns.find((column) => column.field === 'name');
    const renderedCell = nameColumn?.renderCell?.({
      id: -1,
      field: 'name',
      value: '',
      api: {},
      cellMode: 'edit',
      row: { id: -1, type: 'bed', bedId: -1, name: '', level: 2, isNew: true },
    } as never);

    const actionOverlay = findElementByTestId(renderedCell, 'hierarchy-name-actions-overlay');

    render(<>{renderedCell}</>);

    expect(actionOverlay?.props.sx).toMatchObject({
      position: 'absolute',
      right: 0,
      '@media (hover: hover)': {
        '.MuiDataGrid-row:hover &': {
          opacity: 1,
          pointerEvents: 'auto',
        },
      },
      '.MuiDataGrid-row--editing:hover &': {
        opacity: 0,
        pointerEvents: 'none',
      },
    });
    expect(screen.getByRole('button', { name: 'Aktionen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('reveals the full hierarchy name in a tooltip only while it is truncated', async () => {
    mockFinePointer(true);
    const user = userEvent.setup();
    const longName = 'Sehr langer Parzellenname der in der Spalte abgeschnitten wird';

    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );
    const nameColumn = columns.find((column) => column.field === 'name');
    const renderedCell = nameColumn?.renderCell?.({
      id: 'field-10',
      field: 'name',
      value: longName,
      api: {},
      cellMode: 'view',
      row: { id: 'field-10', type: 'field', fieldId: 10, level: 1, expanded: true },
    } as never);

    render(<>{renderedCell}</>);
    const nameText = screen.getByTestId('hierarchy-name-text');

    mockElementOverflow(nameText, { clientWidth: 280, scrollWidth: 280 });
    await user.hover(nameText);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.unhover(nameText);

    mockElementOverflow(nameText, { clientWidth: 280, scrollWidth: 640 });
    await user.hover(nameText);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(longName);
  });

  it('lets long hierarchy names use the full normal-state name cell width', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
      { name: 520 },
    );

    const nameColumn = columns.find((column) => column.field === 'name');
    const renderedCell = nameColumn?.renderCell?.({
      id: 'field-10',
      field: 'name',
      value: 'Sehr langer Parzellenname der bei ausreichender Spaltenbreite vollständig sichtbar bleibt',
      api: {},
      cellMode: 'view',
      row: { id: 'field-10', type: 'field', fieldId: 10, level: 1, expanded: true },
    } as never);

    const textElement = findElementByTestId(renderedCell, 'hierarchy-name-text');
    const actionOverlay = findElementByTestId(renderedCell, 'hierarchy-name-actions-overlay');

    // Truncation and the overflow tooltip come from TruncatedTextWithTooltip;
    // the cell only adds the layout that lets the name claim the free width.
    expect(textElement?.type).toBe(TruncatedTextWithTooltip);
    expect(textElement?.props.sx).toMatchObject({
      flex: '1 1 auto',
      width: '100%',
      maxWidth: 'none',
    });
    expect(actionOverlay?.props.sx).toMatchObject({
      position: 'absolute',
      right: 0,
      pl: 0.25,
      bgcolor: 'background.paper',
      opacity: 0,
      pointerEvents: 'none',
      '&::before': {
        right: '100%',
        width: 16,
        pointerEvents: 'none',
      },
      '@media (hover: hover)': {
        '.MuiDataGrid-row:hover &': {
          opacity: 1,
          pointerEvents: 'auto',
        },
      },
      '.MuiDataGrid-row--editing:hover &': {
        opacity: 0,
        pointerEvents: 'none',
      },
    });
  });

  it('renders chevron only for rows that actually have children', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );

    const nameColumn = columns.find((column) => column.field === 'name');

    const { rerender } = render(
      <>
        {nameColumn?.renderCell?.({
          id: 'field-10',
          field: 'name',
          value: 'Parzelle 10',
          row: { id: 'field-10', type: 'field', fieldId: 10, level: 1, hasChildren: false },
        } as never)}
      </>
    );

    expect(screen.getByTestId('expand-icon-slot')).toBeInTheDocument();
    expect(screen.queryByLabelText('Eintrag aufklappen')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Eintrag zuklappen')).not.toBeInTheDocument();
    expect(screen.getByText('Parzelle 10')).toBeInTheDocument();

    rerender(
      <>
        {nameColumn?.renderCell?.({
          id: 'field-11',
          field: 'name',
          value: 'Parzelle 11',
          row: { id: 'field-11', type: 'field', fieldId: 11, level: 1, expanded: false, hasChildren: true },
        } as never)}
      </>
    );

    expect(screen.getByTestId('expand-icon-slot')).toBeInTheDocument();
    expect(screen.getByLabelText('Eintrag aufklappen')).toBeInTheDocument();
  });



  it('renders directional icons in dimension headers', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );

    const lengthColumn = columns.find((column) => column.field === 'length_m');
    const widthColumn = columns.find((column) => column.field === 'width_m');

    render(
      <>
        {lengthColumn?.renderHeader?.({} as never)}
        {widthColumn?.renderHeader?.({} as never)}
      </>
    );

    expect(screen.getByText('Länge (m)')).toBeInTheDocument();
    expect(screen.getByText('Breite (m)')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="SwapVertIcon"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-testid="SwapHorizIcon"]').length).toBeGreaterThan(0);
  });

  it('embeds the expand/collapse-one-level buttons in the "Name" header when levelToggle is provided', async () => {
    const user = userEvent.setup();
    const onExpandOneLevel = vi.fn();
    const onCollapseOneLevel = vi.fn();
    const parentClick = vi.fn();

    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
      undefined,
      {
        levelToggle: {
          canExpand: true,
          canCollapse: false,
          onExpandOneLevel,
          onCollapseOneLevel,
        },
      },
    );

    const nameColumn = columns.find((column) => column.field === 'name');

    render(
      <div onClick={parentClick}>
        {nameColumn?.renderHeader?.({} as never)}
      </div>,
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    const collapseButton = screen.getByRole('button', { name: 'Eine Hierarchieebene ausblenden' });
    const expandButton = screen.getByRole('button', { name: 'Eine Hierarchieebene mehr anzeigen' });
    expect(collapseButton).toBeDisabled();
    expect(expandButton).not.toBeDisabled();

    await user.click(expandButton);
    expect(onExpandOneLevel).toHaveBeenCalledTimes(1);
    expect(onCollapseOneLevel).not.toHaveBeenCalled();
    // Clicking the header buttons must not bubble into the column header's
    // own sort-toggle click handling.
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('falls back to the plain "Name" header when no levelToggle is provided', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );

    const nameColumn = columns.find((column) => column.field === 'name');
    expect(nameColumn?.renderHeader).toBeUndefined();
    expect(nameColumn?.headerName).toBe('Name');
  });

  it('returns bed dimensions and derived area via value getters', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );

    const lengthColumn = columns.find((column) => column.field === 'length_m');
    const widthColumn = columns.find((column) => column.field === 'width_m');
    const areaColumn = columns.find((column) => column.field === 'area_sqm');

    const bedRow = { id: 100, type: 'bed', level: 2, length_m: 4, width_m: 2.5, area_sqm: 9 };
    const fieldRow = { id: 'field-1', type: 'field', level: 1, area_sqm: 30, length_m: 6, width_m: 4 };

    expect(lengthColumn?.valueGetter?.(undefined, bedRow as never, {} as never, {} as never)).toBe(4);
    expect(widthColumn?.valueGetter?.(undefined, bedRow as never, {} as never, {} as never)).toBe(2.5);
    expect(areaColumn?.valueGetter?.(undefined, bedRow as never, {} as never, {} as never)).toBe(10);

    expect(lengthColumn?.valueGetter?.(undefined, fieldRow as never, {} as never, {} as never)).toBe(6);
    expect(widthColumn?.valueGetter?.(undefined, fieldRow as never, {} as never, {} as never)).toBe(4);
    expect(areaColumn?.valueGetter?.(undefined, fieldRow as never, {} as never, {} as never)).toBe(24);
  });

  it('applies missing-dimension marker classes only to incomplete cells', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );

    const lengthColumn = columns.find((column) => column.field === 'length_m');
    const widthColumn = columns.find((column) => column.field === 'width_m');
    const incompleteRow = { id: 1, type: 'field', level: 1, length_m: null, width_m: 3, area_sqm: null };
    const completeRow = { id: 2, type: 'bed', level: 2, length_m: 5, width_m: 2, area_sqm: null };

    expect(lengthColumn?.cellClassName?.({ row: incompleteRow } as never)).toContain('ofp-hierarchy-cell-missing-dimension');
    expect(lengthColumn?.cellClassName?.({ row: incompleteRow } as never)).toContain('ofp-cell-full-tooltip');
    expect(widthColumn?.cellClassName?.({ row: incompleteRow } as never)).toBe('');

    expect(lengthColumn?.cellClassName?.({ row: completeRow } as never)).toBe('');
    expect(widthColumn?.cellClassName?.({ row: completeRow } as never)).toBe('');
  });

  it('keeps missing-dimension tooltips from intercepting context-menu clicks', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );

    const lengthColumn = columns.find((column) => column.field === 'length_m');
    const renderedCell = lengthColumn?.renderCell?.({
      id: 'field-1',
      field: 'length_m',
      value: null,
      formattedValue: null,
      row: { id: 'field-1', type: 'field', level: 1, length_m: null, width_m: 3, area_sqm: null },
    } as never) as ReactElement<{
      disableInteractive?: boolean;
      slotProps?: { popper?: { style?: { pointerEvents?: string } } };
    }> | undefined;

    expect(renderedCell?.props.disableInteractive).toBe(true);
    expect(renderedCell?.props.slotProps?.popper?.style?.pointerEvents).toBe('none');
  });

  it('marks area as a calculated non-editable column', () => {
    const columns = createHierarchyColumns(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      mockT as never,
    );

    const areaColumn = columns.find((column) => column.field === 'area_sqm');

    expect(areaColumn?.editable).toBe(false);
    expect(areaColumn?.cellClassName).toBe('ofp-cell-calculated');
    expect(areaColumn?.headerClassName).toBe('ofp-header-calculated');
  });

  it('updates footer messaging and add action based on location count', async () => {
    const user = userEvent.setup();
    const onAddField = vi.fn();

    const { rerender } = render(
      <HierarchyFooter locations={[createLocation({ id: 9 })]} onAddField={onAddField} />,
    );

    await user.click(screen.getByLabelText('Parzelle hinzufügen'));
    expect(onAddField).toHaveBeenCalledWith(9);
    expect(screen.getByText('Ein Standort')).toBeInTheDocument();

    rerender(
      <HierarchyFooter
        locations={[createLocation({ id: 9 }), createLocation({ id: 10 })]}
        onAddField={onAddField}
      />,
    );

    expect(screen.queryByLabelText('Parzelle hinzufügen')).not.toBeInTheDocument();
    expect(screen.getByText('Mehrere Standorte')).toBeInTheDocument();
  });
});
