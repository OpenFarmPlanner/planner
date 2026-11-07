import { Fragment, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { Box, Card, CardContent, Chip, Divider, IconButton, Link, Menu, MenuItem, Stack, Typography } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../../api/types';
import { useTranslation } from '../../i18n';
import { resolveLocaleFromLanguage } from '../../utils/numberLocalization';
import { taskDisplayTitle } from './taskTitles';
import { BOARD_STATUSES, type BoardStatus } from './taskBoard';

interface TaskCardProps {
  task: Task;
  compact: boolean;
  saving: boolean;
  cropName?: string;
  areaId?: number;
  areaName?: string;
  personName?: string;
  onStatusChange: (id: number, status: BoardStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export default function TaskCard({
  task, compact, saving, cropName, areaId, areaName, personName, onStatusChange, onEdit, onDelete,
}: TaskCardProps) {
  const { t, i18n } = useTranslation('dashboard');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const dragDisabled = compact || saving;
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id, disabled: dragDisabled,
  });
  const title = taskDisplayTitle(task, t);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage);
  const contextLinks = [
    cropName && task.crop != null && { key: 'crop', label: cropName, to: `/app/crops?cropId=${task.crop}` },
    areaName && areaId != null && { key: 'area', label: areaName, to: `/app/fields-beds?highlight=field:${areaId}` },
  ].filter((link): link is { key: string; label: string; to: string } => Boolean(link));
  const dueDate = task.due_date
    ? new Date(`${task.due_date}T00:00:00`).toLocaleDateString(locale)
    : t('board.noDate');
  return (
    <Card ref={setNodeRef} {...listeners} variant="outlined" component="article" aria-label={title}
      aria-busy={saving} data-task-id={task.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      sx={{ position: 'relative', zIndex: isDragging ? 1 : 'auto', opacity: isDragging ? 0.6 : 1,
        ...(!dragDisabled && { cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'manipulation',
          userSelect: 'none', WebkitTouchCallout: 'none' }) }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
            {contextLinks.length > 0 && <Typography variant="body2" color="text.secondary"
              sx={{ overflowWrap: 'anywhere' }}>
              {contextLinks.map((link, index) => <Fragment key={link.key}>
                {index > 0 && ' · '}
                <Link component={RouterLink} to={link.to} color="inherit" underline="hover"
                  draggable={false}>{link.label}</Link>
              </Fragment>)}
            </Typography>}
          </Box>
          <IconButton disabled={saving} aria-label={t('board.changeStatus', { title })}
            aria-haspopup="menu" aria-expanded={Boolean(anchor)}
            onClick={(event) => setAnchor(event.currentTarget)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack direction="row" sx={{ mt: 1, gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2">{dueDate}</Typography>
          {task.due_date_overridden && <Chip size="small" variant="outlined" label={t('board.dateOverride')} />}
        </Stack>
        {personName && <Typography variant="caption" color="text.secondary"
          sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>{personName}</Typography>}
      </CardContent>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {BOARD_STATUSES.map((status) => <MenuItem key={status} selected={task.status === status}
          disabled={saving || task.status === status} onClick={() => {
            setAnchor(null);
            onStatusChange(task.id, status);
          }}>{t(`board.status.${status}`)}</MenuItem>)}
        <Divider />
        <MenuItem onClick={() => { setAnchor(null); onEdit(task); }}>{t('form.edit')}</MenuItem>
        <MenuItem onClick={() => { setAnchor(null); onDelete(task); }} sx={{ color: 'error.main' }}>{t('form.delete')}</MenuItem>
      </Menu>
    </Card>
  );
}
