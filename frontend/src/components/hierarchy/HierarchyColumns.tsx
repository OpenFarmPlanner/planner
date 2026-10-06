/**
 * Column definitions for hierarchy grid
 */

import type { ReactElement, KeyboardEvent, MouseEvent, PointerEvent, TouchEvent } from 'react';
import { GridEditInputCell } from '@mui/x-data-grid';
import type {
  GridColDef,
  GridRenderCellParams,
  GridRenderEditCellParams,
} from '@mui/x-data-grid';
import type { TFunction } from 'i18next';
import { Box } from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import type { HierarchyRow } from './utils/types';
import {
  calculateAreaValue,
  getDimensionRowState,
  isDimensionCellIncomplete,
  type DimensionCellType,
} from './utils/dimensionCellState';
import { NotesCell } from '../data-grid/NotesCell';
import { renderNameCell } from './hierarchyNameCell';
import {
  NON_BLOCKING_TOOLTIP_PROPS,
  type HierarchyColumnOptions,
  type NameCellCallbacks,
} from './hierarchyColumnShared';
import { getPlainExcerpt } from '../data-grid/markdown';
import { CALCULATED_COLUMN_CELL_CLASS, getCalculatedColumnProps } from '../data-grid/calculatedColumns';
import { HierarchyLevelButtons } from './HierarchyLevelToggle';
import { FullCellTooltip, FULL_CELL_TOOLTIP_CELL_CLASS } from '../data-grid/FullCellTooltip';
import { dataGridHeaderLabelSx } from '../data-grid/dataGridHeaderLabelSx';

export interface HierarchyColumnWidths {
  name: number;
  area: number;
  dimensions: number;
  notes: number;
}

export const DEFAULT_HIERARCHY_COLUMN_WIDTHS: HierarchyColumnWidths = {
  name: 280,
  area: 120,
  dimensions: 130,
  notes: 220,
};

const renderImmediateEditInputCell = (
  params: GridRenderEditCellParams<HierarchyRow>,
): ReactElement => <GridEditInputCell {...params} debounceMs={0} />;
const renderDecimalEditInputCell = (
  params: GridRenderEditCellParams<HierarchyRow>,
): ReactElement => (
  <GridEditInputCell
    {...params}
    debounceMs={0}
    slotProps={{ root: { slotProps: { htmlInput: { inputMode: 'decimal' } } } }}
  />
);

/** Returns true when a dimension edit cell value is non-empty but invalid (non-numeric or negative). */
export const isDimensionEditValueInvalid = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  const str = typeof value === 'string' ? value.trim() : String(value);
  if (str === '') return false;
  const parsed = Number.parseFloat(str.replace(',', '.'));
  return !Number.isFinite(parsed) || parsed < 0;
};

const getDimensionCellClassName = (row: HierarchyRow, type: DimensionCellType): string => {
  const rowState = getDimensionRowState(row);
  if (!rowState) {
    return CALCULATED_COLUMN_CELL_CLASS;
  }
  if (!rowState || !isDimensionCellIncomplete(type, rowState)) {
    return '';
  }
  return `ofp-hierarchy-cell-missing-dimension ${FULL_CELL_TOOLTIP_CELL_CLASS}`;
};

const getNotesCellClassName = (): string => '';

const renderDimensionCell = (
  params: GridRenderCellParams<HierarchyRow>,
  type: DimensionCellType,
  t: TFunction,
): ReactElement => {
  const rowState = getDimensionRowState(params.row);
  const displayValue = params.formattedValue ?? params.value;
  const hasDisplayValue = displayValue !== null && displayValue !== undefined && String(displayValue).trim() !== '';

  if (!rowState || !isDimensionCellIncomplete(type, rowState)) {
    return <Box component="span">{hasDisplayValue ? String(displayValue) : ''}</Box>;
  }

  return (
    <FullCellTooltip
      title={t('hierarchy:messages.missingDimensionsCellTooltip')}
      enterDelay={250}
      cellHasFocus={params.hasFocus}
      {...NON_BLOCKING_TOOLTIP_PROPS}
    >
      <Box
        component="span"
        sx={{
          width: '100%',
          minWidth: 0,
          display: 'inline-flex',
          alignItems: 'center',
          lineHeight: 1.2,
        }}
      >
        <Box
          component="span"
          sx={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: hasDisplayValue ? 'text.primary' : 'text.secondary',
          }}
        >
          {hasDisplayValue ? String(displayValue) : '—'}
        </Box>
      </Box>
    </FullCellTooltip>
  );
};

const renderCalculatedValueCell = (params: GridRenderCellParams<HierarchyRow>): ReactElement => {
  const displayValue = params.formattedValue ?? params.value;
  const hasDisplayValue = displayValue !== null && displayValue !== undefined && String(displayValue).trim() !== '';

  return <Box component="span">{hasDisplayValue ? String(displayValue) : '—'}</Box>;
};

export function createHierarchyColumns(
  onToggleExpand: (rowId: string | number) => void,
  onAddBed: (fieldId: number) => void,
  onDeleteBed: (bedId: number) => void,
  onAddField: (locationId?: number) => void,
  onDeleteField: (fieldId: number) => void,
  onDeleteLocationOrCreatePlantingPlan: ((locationId: number) => void) | ((bedId: number) => void),
  onCreatePlantingPlanOrOpenNotes: ((bedId: number) => void) | ((rowId: string | number, field: string) => void),
  onOpenContextMenuOrT: ((
    event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement> | TouchEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    row: HierarchyRow,
  ) => void) | TFunction,
  onOpenNotesOrColumnWidths?: ((rowId: string | number, field: string) => void) | Partial<HierarchyColumnWidths>,
  tOrColumnWidths?: TFunction | Partial<HierarchyColumnWidths>,
  columnWidths?: Partial<HierarchyColumnWidths>,
  options: HierarchyColumnOptions = {},
): GridColDef<HierarchyRow>[] {
  const usesLegacySignature = typeof onOpenNotesOrColumnWidths !== 'function' && typeof tOrColumnWidths !== 'function';
  const onDeleteLocation = usesLegacySignature
    ? (): void => undefined
    : onDeleteLocationOrCreatePlantingPlan as (locationId: number) => void;
  const onCreatePlantingPlan = usesLegacySignature
    ? onDeleteLocationOrCreatePlantingPlan as (bedId: number) => void
    : onCreatePlantingPlanOrOpenNotes as (bedId: number) => void;
  const onOpenContextMenu = usesLegacySignature
    ? (): void => undefined
    : onOpenContextMenuOrT as (
      event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement> | TouchEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
      row: HierarchyRow,
    ) => void;
  const onOpenNotes = usesLegacySignature
    ? onCreatePlantingPlanOrOpenNotes as (rowId: string | number, field: string) => void
    : onOpenNotesOrColumnWidths as (rowId: string | number, field: string) => void;
  const t = (usesLegacySignature ? onOpenContextMenuOrT : tOrColumnWidths) as TFunction;
  const resolvedColumnWidths = (usesLegacySignature ? onOpenNotesOrColumnWidths : columnWidths) as Partial<HierarchyColumnWidths> | undefined;
  const widths: HierarchyColumnWidths = {
    ...DEFAULT_HIERARCHY_COLUMN_WIDTHS,
    ...resolvedColumnWidths,
  };

  const callbacks: NameCellCallbacks = {
    onToggleExpand,
    onAddBed,
    onDeleteBed,
    onAddField,
    onDeleteField,
    onDeleteLocation,
    onCreatePlantingPlan,
    onOpenContextMenu,
    onOpenContextMenuFromButton: options.onOpenContextMenuFromButton,
  };

  // Captured in a local so the type stays narrowed (non-undefined) inside
  // the "name" column's renderHeader closure below — re-reading
  // options.levelToggle there would widen back to the optional field type.
  const { levelToggle } = options;

  return [
    {
      field: 'name',
      headerName: t('hierarchy:columns.name'),
      width: widths.name,
      editable: true,
      renderEditCell: renderImmediateEditInputCell,
      renderCell: (params) => renderNameCell(params, callbacks, t, options),
      preProcessEditCellProps: (params) => {
        const hasError = !params.props.value || params.props.value.trim() === '';
        return { ...params.props, error: hasError };
      },
      ...(levelToggle ? {
        renderHeader: () => (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              minWidth: 0,
              gap: 1.5,
            }}
          >
            <Box component="span" sx={dataGridHeaderLabelSx}>{t('hierarchy:columns.name')}</Box>
            <HierarchyLevelButtons {...levelToggle} />
          </Box>
        ),
      } : {}),
    },
    {
      field: 'length_m',
      headerName: t('columns.length'),
      renderHeader: () => (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <SwapVertIcon fontSize="small" aria-hidden="true" />
          <Box component="span" sx={dataGridHeaderLabelSx}>{t('columns.length')}</Box>
        </Box>
      ),
      width: widths.dimensions,
      type: 'string',
      editable: true,
      renderEditCell: renderDecimalEditInputCell,
      valueGetter: (_value, row: HierarchyRow) => row.type === 'location' ? undefined : row.length_m,
      cellClassName: (params) => getDimensionCellClassName(params.row, 'length'),
      renderCell: (params) => renderDimensionCell(params, 'length', t),
      preProcessEditCellProps: (params) => ({
        ...params.props,
        error: params.row.type !== 'location' && isDimensionEditValueInvalid(params.props.value),
      }),
    },
    {
      field: 'width_m',
      headerName: t('columns.width'),
      renderHeader: () => (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <SwapHorizIcon fontSize="small" aria-hidden="true" />
          <Box component="span" sx={dataGridHeaderLabelSx}>{t('columns.width')}</Box>
        </Box>
      ),
      width: widths.dimensions,
      type: 'string',
      editable: true,
      renderEditCell: renderDecimalEditInputCell,
      valueGetter: (_value, row: HierarchyRow) => row.type === 'location' ? undefined : row.width_m,
      cellClassName: (params) => getDimensionCellClassName(params.row, 'width'),
      renderCell: (params) => renderDimensionCell(params, 'width', t),
      preProcessEditCellProps: (params) => ({
        ...params.props,
        error: params.row.type !== 'location' && isDimensionEditValueInvalid(params.props.value),
      }),
    },
    {
      field: 'area_sqm',
      headerName: t('hierarchy:columns.area'),
      width: widths.area,
      type: 'string',
      ...getCalculatedColumnProps<HierarchyRow>({
        headerName: t('hierarchy:columns.area'),
        tooltip: t('hierarchy:tooltips.calculatedArea'),
      }),
      valueGetter: (_value, row: HierarchyRow) => calculateAreaValue(row),
      renderCell: renderCalculatedValueCell,
    },
    {
      field: 'notes',
      headerName: t('common:fields.notes'),
      width: widths.notes,
      minWidth: widths.notes,
      flex: 1,
      editable: false,
      cellClassName: () => getNotesCellClassName(),
      renderCell: (params) => {
        const value = (params.value as string) || '';
        const hasValue = value.trim().length > 0;
        const excerpt = hasValue ? getPlainExcerpt(value, 120) : '';

        return (
          <Box
            sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}
            onClick={() => onOpenNotes(params.id, 'notes')}
          >
            <NotesCell
              hasValue={hasValue}
              excerpt={excerpt}
              rawValue={value}
              onOpen={() => onOpenNotes(params.id, 'notes')}
            />
          </Box>
        );
      },
    },
  ];
}
