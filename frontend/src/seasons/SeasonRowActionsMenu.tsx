import { Divider, ListItemIcon, Menu, MenuItem } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import DateRangeIcon from '@mui/icons-material/DateRangeOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { useTranslation } from '../i18n';
import { ACTION_MENU_ICON_PROPS, ACTION_MENU_ITEM_ICON_SX } from '../navigation/topbarMenuStyles';

interface SeasonRowActionsMenuProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onCopyDataFrom: () => void;
  onRename: () => void;
  onEditPeriod: () => void;
  onDelete: () => void;
}

export function SeasonRowActionsMenu({
  anchorEl, onClose, onCopyDataFrom, onRename, onEditPeriod, onDelete,
}: SeasonRowActionsMenuProps) {
  const { t } = useTranslation('navigation');

  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}>
      <MenuItem onClick={() => { onClose(); onCopyDataFrom(); }}>
        <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><ContentCopyIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
        {t('seasonSwitcher.menu.copyData')}
      </MenuItem>
      <MenuItem onClick={() => { onClose(); onRename(); }}>
        <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><EditIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
        {t('seasonSwitcher.menu.rename')}
      </MenuItem>
      <MenuItem onClick={() => { onClose(); onEditPeriod(); }}>
        <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><DateRangeIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
        {t('seasonSwitcher.menu.editPeriod')}
      </MenuItem>
      <Divider sx={{ my: 0.5 }} />
      <MenuItem onClick={() => { onClose(); onDelete(); }} sx={{ color: 'error.main' }}>
        <ListItemIcon sx={{ ...ACTION_MENU_ITEM_ICON_SX, color: 'error.main' }}><DeleteIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
        {t('seasonSwitcher.menu.delete')}
      </MenuItem>
    </Menu>
  );
}
