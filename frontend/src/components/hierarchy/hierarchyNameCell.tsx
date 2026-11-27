import { Box, IconButton, type Theme } from '@mui/material';
import type { GridRenderCellParams } from '@mui/x-data-grid';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { TFunction } from 'i18next';
import type { HierarchyRow } from './utils/types';
import { CONTEXT_MENU_INDICATOR_CLASS } from '../contextMenu/contextMenuIndicatorStyles';
import { renderInlineActions, renderMoreActionsButton } from './hierarchyRowActions';
import {
  NON_BLOCKING_TOOLTIP_PROPS,
  type HierarchyColumnOptions,
  type NameCellCallbacks,
} from './hierarchyColumnShared';
import { AppTooltip } from '../AppTooltip';
import { TruncatedTextWithTooltip } from '../TruncatedTextWithTooltip';
import { IndividualPlantIcon } from '../../planting-plans/individualPlantActions';
import {
  getHierarchyNameTextOffsetPx, hierarchyNameText, HIERARCHY_EXPAND_MARGIN_PX, HIERARCHY_EXPAND_SLOT_PX, HIERARCHY_NAME_GAP_PX,
  HIERARCHY_NAME_INDENT_PX, HIERARCHY_TOUCH_ACTION_PX,
} from './utils/hierarchyNameColumnWidth';

export { getHierarchyNameTextOffsetPx } from './utils/hierarchyNameColumnWidth';

const revealActions = { opacity: 1, pointerEvents: 'auto' as const };
const hoverRow = '.MuiDataGrid-row:hover &';
const keyboardFocusedRow = '.MuiDataGrid-row:has(:focus-visible) &';
const overlaySurface = '--ofp-hierarchy-overlay-surface';
// Space needed to show all three actions without reaching the expander.
const actionsWidth = 96;

export function renderNameCell(
  params: GridRenderCellParams<HierarchyRow>,
  callbacks: NameCellCallbacks,
  t: TFunction,
  options: HierarchyColumnOptions,
) {
  const row = params.row;
  const baseIndent = row.level * HIERARCHY_NAME_INDENT_PX;
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
        width: HIERARCHY_TOUCH_ACTION_PX,
        height: HIERARCHY_TOUCH_ACTION_PX,
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
  const text = hierarchyNameText(row, params.value, t, Boolean(options.showInlineIndividualCount));
  const quickActionsMinWidth = getHierarchyNameTextOffsetPx(row.level) + HIERARCHY_NAME_GAP_PX + actionsWidth;

  return (
    <Box sx={{
      position: 'relative', containerType: 'inline-size', containerName: 'hierarchy-name',
      display: 'flex', alignItems: 'center', width: '100%', minWidth: 0, gap: `${HIERARCHY_NAME_GAP_PX}px`,
    }}>
      <Box
        sx={{
          width: HIERARCHY_EXPAND_SLOT_PX,
          minWidth: HIERARCHY_EXPAND_SLOT_PX,
          height: HIERARCHY_EXPAND_SLOT_PX,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          ml: `${baseIndent}px`,
          mr: `${HIERARCHY_EXPAND_MARGIN_PX}px`,
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
            sx={{ width: HIERARCHY_EXPAND_SLOT_PX, height: HIERARCHY_EXPAND_SLOT_PX, visibility: 'hidden' }}
          >
            <ChevronRightIcon />
          </Box>
        )}
      </Box>

      <Box
        sx={{
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
      </Box>
      {persistentContextMenuButton || inlineActions ? (
        <Box
          data-testid="hierarchy-name-actions-overlay"
          sx={{
            position: 'absolute',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            px: 0.25,
            borderRadius: 1,
            [overlaySurface]: (theme: Theme) => theme.palette.background.paper,
            bgcolor: `var(${overlaySurface})`,
            opacity: 0,
            pointerEvents: 'none',
            transition: 'opacity 120ms ease-in-out',
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: '0 100% 0 auto',
              width: 12,
              pointerEvents: 'none',
              background: `linear-gradient(to right, transparent, var(${overlaySurface}))`,
            },
            [hoverRow]: {
              [overlaySurface]: (theme: Theme) => theme.palette.surface?.surfaceHoverBackground ?? theme.palette.background.paper,
            },
            '.MuiDataGrid-row.Mui-selected:hover .MuiDataGrid-cell--editable:not(:hover, :focus-within) &': {
              [overlaySurface]: (theme: Theme) => theme.palette.surface?.surfaceBackground ?? theme.palette.background.paper,
            },
            '@media (hover: hover)': {
              [hoverRow]: revealActions,
              [keyboardFocusedRow]: revealActions,
              [`${hoverRow} .${CONTEXT_MENU_INDICATOR_CLASS}`]: revealActions,
              [`${keyboardFocusedRow} .${CONTEXT_MENU_INDICATOR_CLASS}`]: revealActions,
            },
            [`@container hierarchy-name (width < ${quickActionsMinWidth}px)`]: {
              [`& .action-icons > :not(.${CONTEXT_MENU_INDICATOR_CLASS})`]: { display: 'none' },
            },
            ...(isStandaloneRender || persistentContextMenuButton ? revealActions : {}),
            '.MuiDataGrid-row--editing &': { display: 'none' },
          }}
        >
          {persistentContextMenuButton ?? inlineActions}
        </Box>
      ) : null}
    </Box>
  );
}
