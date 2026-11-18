import type { ReactElement } from 'react';
import type { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { Box } from '@mui/material';
import type { TFunction } from 'i18next';
import type { HierarchyRow } from './utils/types';
import {
  INLINE_SITE_CONDITION_FIELDS,
  SITE_CONDITION_OPTIONS,
  type InlineSiteConditionField,
} from './utils/siteConditions';
import {
  getInheritedSourceLabel,
  getSiteConditionFieldHelp,
  getSiteConditionFieldLabel,
  getSiteConditionValueLabel,
} from './siteConditionLabels';
import { INHERIT_VALUE, SiteConditionEditCell, type SiteConditionOption } from './SiteConditionEditCell';
import { FullCellTooltip, FULL_CELL_TOOLTIP_CELL_CLASS } from '../data-grid/FullCellTooltip';
import { NON_BLOCKING_TOOLTIP_PROPS } from './hierarchyColumnShared';


function buildEditOptions(
  t: TFunction,
  row: HierarchyRow,
  field: InlineSiteConditionField,
): SiteConditionOption[] {
  // A location has no parent, so clearing its value means "not specified".
  const inheritLabel = row.type === 'location'
    ? t('hierarchy:siteConditions.notSpecified')
    : t('hierarchy:siteConditions.inheritOption', {
      value: getSiteConditionValueLabel(t, field, row.inheritedSiteConditions?.[field]?.value),
    });
  return [
    { value: INHERIT_VALUE, label: inheritLabel },
    ...SITE_CONDITION_OPTIONS[field].map((value) => ({
      value,
      label: getSiteConditionValueLabel(t, field, value),
    })),
  ];
}

function renderSiteConditionCell(
  params: GridRenderCellParams<HierarchyRow>,
  field: InlineSiteConditionField,
  t: TFunction,
): ReactElement {
  const effective = params.row.effectiveSiteConditions?.[field];
  const inheritedFrom = getInheritedSourceLabel(t, effective, params.row.type);
  const label = effective?.value ? getSiteConditionValueLabel(t, field, effective.value) : '—';
  const content = (
    <Box
      component="span"
      data-testid={`site-condition-${field}`}
      data-inherited={inheritedFrom ? 'true' : undefined}
      sx={{
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: inheritedFrom || !effective?.value ? 'text.secondary' : 'text.primary',
      }}
    >
      {label}
    </Box>
  );
  if (!inheritedFrom) {
    return content;
  }
  return (
    <FullCellTooltip
      title={inheritedFrom}
      enterDelay={250}
      cellHasFocus={params.hasFocus}
      {...NON_BLOCKING_TOOLTIP_PROPS}
    >
      {content}
    </FullCellTooltip>
  );
}

/** The optional site-condition columns, hidden until enabled in the Columns panel. */
export function createSiteConditionColumns(t: TFunction): GridColDef<HierarchyRow>[] {
  return INLINE_SITE_CONDITION_FIELDS.map((field) => ({
    field,
    headerName: getSiteConditionFieldLabel(t, field),
    description: getSiteConditionFieldHelp(t, field),
    width: 150,
    editable: true,
    sortable: false,
    valueGetter: (_value, row: HierarchyRow) => row[field] ?? INHERIT_VALUE,
    // The inherited-source tooltip covers the whole cell (FullCellTooltip).
    cellClassName: () => FULL_CELL_TOOLTIP_CELL_CLASS,
    renderCell: (params) => renderSiteConditionCell(params, field, t),
    renderEditCell: (params) => (
      <SiteConditionEditCell {...params} options={buildEditOptions(t, params.row, field)} />
    ),
  }));
}
