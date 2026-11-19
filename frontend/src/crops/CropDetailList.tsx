import { useId, useState, type ReactNode } from 'react';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { AppTooltip } from '../components/AppTooltip';
import { useTranslation } from '../i18n';

const wideList = '@container (min-width: 38rem)';

export function CropDetailList({ children }: { children: ReactNode }) {
  return <Box component="ul" role="list" sx={{
    m: 0, p: 0, listStyle: 'none', containerType: 'inline-size',
    '& > li + li': { borderTop: '1px solid', borderColor: 'divider' },
  }}>
    {children}
  </Box>;
}

interface CropDetailListRowProps {
  name: string;
  metadata: ReactNode;
  description?: string;
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

export function CropDetailListRow({
  name, metadata, description, editLabel, deleteLabel, onEdit, onDelete, disabled,
}: CropDetailListRowProps) {
  const { t } = useTranslation('common');
  const menuId = useId();
  const buttonId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const actions = t('actions.moreActions');
  const showDescription = Boolean(description?.trim());
  return (
    <Box component="li" sx={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gridTemplateAreas: showDescription ? '"name actions" "description description" "metadata metadata"' : '"name actions" "metadata metadata"',
      alignItems: 'start',
      columnGap: 1,
      rowGap: 0.25,
      minWidth: 0,
      py: 0.75,
      overflowWrap: 'anywhere',
      [wideList]: {
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr) auto',
        gridTemplateAreas: showDescription ? '"name metadata actions" "description description ."' : '"name metadata actions"',
        columnGap: 2,
      },
    }}>
      <Typography variant="subtitle2" sx={{ gridArea: 'name', minWidth: 0, pt: 0.75 }}>
        {name}
      </Typography>
      {showDescription && <Typography variant="body2" sx={{ gridArea: 'description', minWidth: 0, whiteSpace: 'pre-wrap', pb: 0.25 }}>
        {description}
      </Typography>}
      <Box sx={{
        gridArea: 'metadata', minWidth: 0, display: 'grid', gap: 0.5, pb: 0.5,
        [wideList]: { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 8em), 1fr))', columnGap: 1.5, pt: 0.75 },
      }}>
        {metadata}
      </Box>
      <Box sx={{ gridArea: 'actions' }}>
        <AppTooltip title={actions}>
          <span>
            <IconButton
              id={buttonId}
              aria-label={`${actions} — ${name}`}
              aria-haspopup="menu"
              aria-expanded={Boolean(anchor)}
              aria-controls={anchor ? menuId : undefined}
              disabled={disabled}
              onClick={event => {
                event.currentTarget.focus({ preventScroll: true });
                setAnchor(event.currentTarget);
              }}
              sx={{ width: 44, height: 44 }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </span>
        </AppTooltip>
        <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
          slotProps={{ list: { id: menuId, 'aria-labelledby': buttonId } }}>
          <MenuItem aria-label={editLabel} onClick={() => { setAnchor(null); onEdit(); }}>
            <ListItemIcon><EditOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('actions.edit')}</ListItemText>
          </MenuItem>
          <MenuItem aria-label={deleteLabel} onClick={() => { setAnchor(null); onDelete(); }} sx={{ color: 'error.main' }}>
            <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('actions.delete')}</ListItemText>
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );
}
