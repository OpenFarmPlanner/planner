import { useId, useState, type ReactNode } from 'react';
import { Button, Menu } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from '../../i18n';
import { AppTooltip } from '../AppTooltip';
import { TOOLBAR_ACTION_MIN_HEIGHT } from '../buttons/ResponsiveToolbarAction';
import { getStandardActionButtonSx } from '../buttons/segmentedControlStyles';
import { useContextMenuOpenRegistration } from '../contextMenu/contextMenuOpenState';

type WorkspaceAction = (trigger: HTMLButtonElement, keyboard: boolean) => void;

export function GrowingAreaWorkspaceMenu({ editing = false, description, children }: {
  editing?: boolean;
  description?: string;
  children: (select: (action: WorkspaceAction, keyboard?: boolean) => void) => ReactNode;
}) {
  const { t } = useTranslation('fields');
  const label = t('workspaceActions');
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [afterClose, setAfterClose] = useState<(() => void) | null>(null);
  useContextMenuOpenRegistration(Boolean(anchor));

  const select = (action: WorkspaceAction, keyboard = false) => {
    if (anchor) setAfterClose(() => () => {
      anchor.focus({ preventScroll: true });
      action(anchor, keyboard);
    });
    setAnchor(null);
  };

  return (
    <>
      <AppTooltip title={label} disableFocusListener disableInteractive>
        <Button aria-label={label} aria-description={description} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
          aria-controls={anchor ? id : undefined} onClick={event => setAnchor(event.currentTarget)}
          variant={editing ? 'contained' : 'outlined'} color={editing ? 'success' : 'inherit'}
          sx={{ ...getStandardActionButtonSx(true), minWidth: TOOLBAR_ACTION_MIN_HEIGHT,
            minHeight: TOOLBAR_ACTION_MIN_HEIGHT, flexShrink: 0 }}>
          <MoreVertIcon fontSize="small" />
        </Button>
      </AppTooltip>
      <Menu open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          list: { id, 'aria-label': label },
          transition: { onExited: () => {
            setAfterClose(null);
            afterClose?.();
          } },
        }}>
        {children(select)}
      </Menu>
    </>
  );
}
