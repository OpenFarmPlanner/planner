import type { ComponentProps, ReactElement, MouseEvent } from 'react';
import type { TFunction } from 'i18next';
import { Box, IconButton } from '@mui/material';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import DeleteIcon from '@mui/icons-material/Delete';
import type { HierarchyRow } from './utils/types';
import { HierarchyAddIcon } from './HierarchyAddIcon';
import { ContextMenuIndicator } from '../contextMenu/ContextMenuIndicator';
import {
  NON_BLOCKING_TOOLTIP_PROPS,
  type HierarchyColumnOptions,
  type NameCellCallbacks,
} from './hierarchyColumnShared';
import { AppTooltip } from '../AppTooltip';

function renderHierarchyAddIconButton({
  label,
  onClick,
}: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <HierarchyAddIcon
      ariaLabel={label}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      sx={{ p: 0.5, '& .MuiSvgIcon-root': { fontSize: 18 } }}
    />
  );
}

function renderPlantingPlanActionButton(
  row: HierarchyRow,
  callbacks: NameCellCallbacks,
  t: TFunction,
): ReactElement | null {
  if (row.type !== 'bed' || row.bedId === undefined) {
    return null;
  }

  return (
    <AppTooltip title={t('hierarchy:createPlantingPlan')} {...NON_BLOCKING_TOOLTIP_PROPS}>
      <IconButton
        size="small"
        color="primary"
        aria-label={t('hierarchy:createPlantingPlan')}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          callbacks.onCreatePlantingPlan(row.bedId!);
        }}
        sx={{
          p: 0.5,
          '& .MuiSvgIcon-root': { fontSize: 18 },
          '&:hover': {
            bgcolor: 'action.hover',
          },
          '&.Mui-focusVisible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: 1,
          },
        }}
      >
        <AgricultureIcon />
      </IconButton>
    </AppTooltip>
  );
}

function renderDeleteActionButton(
  row: HierarchyRow,
  callbacks: NameCellCallbacks,
  t: TFunction,
): ReactElement | null {
  const label = t('common:actions.delete');

  if (row.type === 'location' && row.locationId !== undefined) {
    return (
      <IconButton
        size="small"
        color="error"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          callbacks.onDeleteLocation(row.locationId!);
        }}
        sx={{ p: 0.5, '& .MuiSvgIcon-root': { fontSize: 18 } }}
      >
        <DeleteIcon />
      </IconButton>
    );
  }

  if (row.type === 'field' && row.fieldId !== undefined) {
    return (
      <IconButton
        size="small"
        color="error"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          callbacks.onDeleteField(row.fieldId!);
        }}
        sx={{ p: 0.5, '& .MuiSvgIcon-root': { fontSize: 18 } }}
      >
        <DeleteIcon />
      </IconButton>
    );
  }

  if (row.type === 'bed' && row.bedId !== undefined) {
    return (
      <IconButton
        size="small"
        color="error"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          callbacks.onDeleteBed(row.bedId!);
        }}
        sx={{ p: 0.5, '& .MuiSvgIcon-root': { fontSize: 18 } }}
      >
        <DeleteIcon />
      </IconButton>
    );
  }

  return null;
}

export function renderMoreActionsButton(
  row: HierarchyRow,
  callbacks: NameCellCallbacks,
  t: TFunction,
  isStandaloneRender: boolean,
  sx?: ComponentProps<typeof ContextMenuIndicator>['sx'],
): ReactElement {
  return (
    <ContextMenuIndicator
      label={t('common:actions.actions')}
      showTooltip={false}
      tabIndex={-1}
      onClick={(event) => callbacks.onOpenContextMenu(event, row)}
      onTouchActivate={
        callbacks.onOpenContextMenuFromButton
          ? (event) => callbacks.onOpenContextMenuFromButton?.(row, event.currentTarget)
          : undefined
      }
      sx={sx ?? (isStandaloneRender ? { opacity: 1, pointerEvents: 'auto' } : undefined)}
    />
  );
}

export function renderInlineActions(
  row: HierarchyRow,
  callbacks: NameCellCallbacks,
  t: TFunction,
  options: HierarchyColumnOptions,
  isStandaloneRender: boolean,
): ReactElement | null {
  if (options.disableInlineHoverActions) {
    return null;
  }

  if (row.type === 'location') {
    return (
      <Box className="action-icons" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        {renderHierarchyAddIconButton({
          label: t('hierarchy:addField'),
          onClick: () => callbacks.onAddField(row.locationId),
        })}
        {renderDeleteActionButton(row, callbacks, t)}
        {renderMoreActionsButton(row, callbacks, t, isStandaloneRender)}
      </Box>
    );
  }

  if (row.type === 'field') {
    return (
      <Box className="action-icons" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        {renderHierarchyAddIconButton({
          label: t('hierarchy:addBedToField'),
          onClick: () => callbacks.onAddBed(row.fieldId!),
        })}
        {renderDeleteActionButton(row, callbacks, t)}
        {renderMoreActionsButton(row, callbacks, t, isStandaloneRender)}
      </Box>
    );
  }

  if (row.type === 'bed') {
    return (
      <Box className="action-icons" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        {renderPlantingPlanActionButton(row, callbacks, t)}
        {renderDeleteActionButton(row, callbacks, t)}
        {renderMoreActionsButton(row, callbacks, t, isStandaloneRender)}
      </Box>
    );
  }

  return renderMoreActionsButton(row, callbacks, t, isStandaloneRender);
}
