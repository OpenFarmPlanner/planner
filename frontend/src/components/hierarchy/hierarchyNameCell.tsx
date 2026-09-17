import { Box, IconButton } from '@mui/material';
import type { GridRenderCellParams } from '@mui/x-data-grid';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { TFunction } from 'i18next';
import type { HierarchyRow } from './utils/types';
import { contextMenuActionsOverlaySx } from '../contextMenu/contextMenuIndicatorStyles';
import { renderInlineActions, renderMoreActionsButton } from './hierarchyRowActions';
import {
  NON_BLOCKING_TOOLTIP_PROPS,
  type HierarchyColumnOptions,
  type NameCellCallbacks,
} from './hierarchyColumnShared';
import { AppTooltip } from '../AppTooltip';
import { TruncatedTextWithTooltip } from '../TruncatedTextWithTooltip';

const EXPAND_ICON_SLOT_SIZE = 32;

export function renderNameCell(
  params: GridRenderCellParams<HierarchyRow>,
  callbacks: NameCellCallbacks,
  t: TFunction,
  options: HierarchyColumnOptions,
) {
  const row = params.row;
  const baseIndent = row.level * 24;
  const hasChildren = row.hasChildren === true;
  const hasExpandToggle = (row.type === 'location' || row.type === 'field') && hasChildren;
  const isStandaloneRender = params.api === undefined;
  const inlineActions = renderInlineActions(row, callbacks, t, options, isStandaloneRender);
  const supportsContextMenu = row.type === 'location' || row.type === 'field' || row.type === 'bed';
  const persistentContextMenuButton = supportsContextMenu && options.showPersistentContextMenuButton
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
        <TruncatedTextWithTooltip
          text={String(params.value ?? '')}
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
              ...contextMenuActionsOverlaySx('.MuiDataGrid-row:hover &'),
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
