import { useState } from 'react';
import { Box, Card, CardContent, Chip, Divider, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
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
  areaName?: string;
  personName?: string;
  onStatusChange: (id: number, status: BoardStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export default function TaskCard({
  task, compact, saving, cropName, areaName, personName, onStatusChange, onEdit, onDelete,
}: TaskCardProps) {
  const { t, i18n } = useTranslation('dashboard');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: task.id, disabled: compact || saving,
  });
  const title = taskDisplayTitle(task, t);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage);
  const dueDate = task.due_date
    ? new Date(`${task.due_date}T00:00:00`).toLocaleDateString(locale)
    : t('board.noDate');
  return (
    <Card ref={setNodeRef} variant="outlined" component="article" aria-label={title}
      aria-busy={saving} data-task-id={task.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      sx={{ position: 'relative', zIndex: isDragging ? 1 : 'auto', opacity: isDragging ? 0.6 : 1 }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          {!compact && <IconButton ref={setActivatorNodeRef} {...attributes} {...listeners}
            disabled={saving} aria-label={t('board.dragTask', { title })}
            sx={{ cursor: 'grab', touchAction: 'none', flexShrink: 0 }}>
            <DragIndicatorIcon fontSize="small" />
          </IconButton>}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
            {(cropName || areaName) && <Typography variant="body2" color="text.secondary"
              sx={{ overflowWrap: 'anywhere' }}>{[cropName, areaName].filter(Boolean).join(' · ')}</Typography>}
          </Box>
          <IconButton disabled={saving} aria-label={t('board.changeStatus', { title })}
            aria-haspopup="menu" aria-expanded={Boolean(anchor)}
            onClick={(event) => setAnchor(event.currentTarget)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack direction="row" sx={{ mt: 1, gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2">{dueDate}</Typography>
          <Chip size="small" variant="outlined" label={t(`board.origin.${task.origin}`)} />
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
