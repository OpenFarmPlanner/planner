import { Box, IconButton } from '@mui/material';
import type { GridRenderCellParams } from '@mui/x-data-grid';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { TFunction } from 'i18next';
import type { HierarchyRow } from './utils/types';
import { contextMenuActionsSlotSx } from '../contextMenu/contextMenuIndicatorStyles';
import { renderInlineActions, renderMoreActionsButton } from './hierarchyRowActions';
import {
  NON_BLOCKING_TOOLTIP_PROPS,
  type HierarchyColumnOptions,
  type NameCellCallbacks,
} from './hierarchyColumnShared';
import { AppTooltip } from '../AppTooltip';
import { TruncatedTextWithTooltip } from '../TruncatedTextWithTooltip';
import { IndividualPlantIcon } from '../../planting-plans/individualPlantActions';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../../utils/numberLocalization';

const EXPAND_ICON_SLOT_SIZE = 32;
const LEVEL_INDENT_PX = 24;
// The expand slot's right margin (`mr: 1`).
const EXPAND_ICON_SLOT_GAP_PX = 8;
/**
 * Width kept free for the hover actions (add/plan, delete, more) at the end
 * of the name, so the name column's content width includes them (#1576).
 */
export const HIERARCHY_ROW_ACTIONS_SLOT_PX = 96;

/** Where the name text starts inside the cell, so the edit input can line up with it. */
export const getHierarchyNameTextOffsetPx = (level: number): number =>
  level * LEVEL_INDENT_PX + EXPAND_ICON_SLOT_SIZE + EXPAND_ICON_SLOT_GAP_PX;

export function renderNameCell(
  params: GridRenderCellParams<HierarchyRow>,
  callbacks: NameCellCallbacks,
  t: TFunction,
  options: HierarchyColumnOptions,
) {
  const row = params.row;
  const baseIndent = row.level * LEVEL_INDENT_PX;
  const hasChildren = row.hasChildren === true;
  const hasExpandToggle = hasChildren && (row.type === 'location' || row.type === 'field'
    || (row.type === 'bed' && row.individualPlantCount !== undefined));
  const isStandaloneRender = params.api === undefined;
  const inlineActions = renderInlineActions(row, callbacks, t, options, isStandaloneRender);
  const persistentContextMenuButton = options.showPersistentContextMenuButton
    ? renderMoreActionsButton(row, callbacks, t, true, {
        display: 'inline-flex',
        opacity: 1,
        pointerEvents: 'auto',
        flex: '0 0 auto',
        width: 40,
        height: 40,
        color: 'text.secondary',
        p: 1,
        '& .MuiSvgIcon-root': { fontSize: 20 },
        '&:hover': { bgcolor: 'action.hover' },
        '&.Mui-focusVisible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: -3,
        },
      })
    : null;
  const count = row.individualPlantCount;
  const countLabel = row.type === 'individualPlan' && options.showInlineIndividualCount && count !== undefined
    ? t('fields:individualPlants.count', { count, formatted: formatLocalizedNumber(count, getActiveFormattingLocale()) }) : '';
  const text = [String(params.value ?? ''), countLabel].filter(Boolean).join(' · ');

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', pl: `${baseIndent}px`, width: '100%', minWidth: 0, gap: 0.5 }}>
      <Box
        sx={{
          width: EXPAND_ICON_SLOT_SIZE,
          minWidth: EXPAND_ICON_SLOT_SIZE,
          height: EXPAND_ICON_SLOT_SIZE,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          mr: 1,
          pointerEvents: hasExpandToggle ? 'auto' : 'none',
        }}
        data-testid="expand-icon-slot"
      >
        {hasExpandToggle ? (
          <AppTooltip title={row.expanded ? t('tooltips.collapse') : t('tooltips.expand')} {...NON_BLOCKING_TOOLTIP_PROPS}>
            <IconButton
              size="small"
              aria-label={row.expanded ? t('tooltips.collapse') : t('tooltips.expand')}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                callbacks.onToggleExpand(row.id);
              }}
            >
              {row.expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
            </IconButton>
          </AppTooltip>
        ) : (
          <Box
            aria-hidden="true"
            sx={{ width: EXPAND_ICON_SLOT_SIZE, height: EXPAND_ICON_SLOT_SIZE, visibility: 'hidden' }}
          >
            <ChevronRightIcon />
          </Box>
        )}
      </Box>

      <Box
        sx={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          minWidth: 0,
          flex: '1 1 auto',
          width: 'auto',
          overflow: 'hidden',
        }}
        onContextMenu={(event) => {
          callbacks.onOpenContextMenu(event, row);
        }}
      >
        {row.type === 'individualPlan' && <IndividualPlantIcon fontSize="small"
          titleAccess={t('fields:individualPlants.title')} sx={{ flexShrink: 0, mr: 0.5, color: 'text.secondary' }} />}
        <TruncatedTextWithTooltip
          text={text}
          data-testid="hierarchy-name-text"
          sx={{
            flex: '1 1 auto',
            width: '100%',
            maxWidth: 'none',
            boxSizing: 'border-box',
            fontWeight: row.type === 'location' ? 600 : 400,
            fontSize: row.type === 'location' ? '1.02rem' : row.type === 'bed' ? '0.95rem' : '1rem',
            color: 'text.primary',
            bgcolor: 'transparent',
            borderRadius: 0.5,
            px: row.type === 'bed' ? 0.5 : 0,
          }}
        />

        {persistentContextMenuButton}

        {inlineActions ? (
          <Box
            data-testid="hierarchy-name-actions-overlay"
            sx={{
              ...contextMenuActionsSlotSx('.MuiDataGrid-row:hover &'),
              ...(isStandaloneRender ? { opacity: 1, pointerEvents: 'auto' } : {}),
              '.MuiDataGrid-row--editing:hover &': { opacity: 0, pointerEvents: 'none' },
            }}
          >
            {inlineActions}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
