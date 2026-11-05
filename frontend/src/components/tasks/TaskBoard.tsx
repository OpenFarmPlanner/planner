import { useMemo, useState, type ReactNode } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, MenuItem,
  Paper, Stack, TextField, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  DndContext, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { Bed, Crop, Field, PlantingPlan, Task } from '../../api/types';
import type { ProjectMemberPayload } from '../../api/api';
import { useTranslation } from '../../i18n';
import { taskDisplayTitle } from './taskTitles';
import TaskCard from './TaskCard';
import { formatCropDisplayName } from '../../crops/cropDisplay';
import {
  BOARD_STATUSES, EMPTY_TASK_FILTERS, isBoardStatus, taskDateBounds, taskMatchesFilters,
  taskMetrics, type BoardStatus, type TaskFilters, type TaskPeriod,
} from './taskBoard';

interface Props {
  tasks: Task[];
  crops: Crop[];
  fields: Field[];
  beds: Bed[];
  plans: PlantingPlan[];
  members: ProjectMemberPayload[];
  savingIds: number[];
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  onStatusChange: (id: number, status: BoardStatus) => void;
  onCreate: () => void;
  hasSeason: boolean;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

const STATUS_COLOR = { pending: 'info.main', in_progress: 'warning.main', completed: 'success.main' };

function TaskColumn({ status, count, compact, children }: {
  status: BoardStatus; count: number; compact: boolean; children: ReactNode;
}) {
  const { t } = useTranslation('dashboard');
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: compact });
  return (
    <Paper ref={setNodeRef} component="section" variant="outlined"
      aria-label={t(`board.status.${status}`)} data-task-column={status}
      sx={{ p: 1.5, minWidth: 0, bgcolor: isOver ? 'action.hover' : 'surface.surfaceBackground',
        borderColor: isOver ? 'primary.main' : 'divider', minHeight: compact ? 0 : 200 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'center' }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STATUS_COLOR[status] }} />
        <Typography component="h2" variant="subtitle1" sx={{ flex: 1 }}>
          {t(`board.status.${status}`)}
        </Typography>
        <Chip size="small" label={count} />
      </Stack>
      <Stack spacing={1}>{children}</Stack>
    </Paper>
  );
}

export default function TaskBoard({
  tasks, crops, fields, beds, plans, members, savingIds, filters, onFiltersChange, onStatusChange, onCreate, hasSeason, onEdit, onDelete,
}: Props) {
  const { t } = useTranslation('dashboard');
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  const [limits, setLimits] = useState<Record<BoardStatus, number>>({
    pending: 30, in_progress: 30, completed: 30,
  });
  const bounds = taskDateBounds(new Date());
  const cropById = useMemo(() => new Map(crops.map((crop) => [crop.id, crop])), [crops]);
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const bedById = useMemo(() => new Map(beds.map((bed) => [bed.id, bed])), [beds]);
  const planById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const personById = useMemo(() => new Map(members.map((member) => [member.user,
    member.user_display_name || member.user_email])), [members]);
  const fieldForTask = (task: Task) => {
    if (task.planting_plan == null) return task.field ?? undefined;
    const bedId = task.planting_plan === null ? null : planById.get(task.planting_plan)?.bed;
    return bedId == null ? undefined : bedById.get(bedId)?.field;
  };
  const invalidRange = filters.period === 'custom' && Boolean(filters.from && filters.to && filters.from > filters.to);
  const filtered = invalidRange ? [] : tasks.filter((task) => taskMatchesFilters(task, filters, fieldForTask(task), bounds));
  const metrics = taskMetrics(filtered, bounds);
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_TASK_FILTERS);
  const updateFilter = (key: keyof TaskFilters, value: string) => onFiltersChange({ ...filters, [key]: String(value) });
  const filterControls = <Box sx={{ display: 'grid', gap: 1.5,
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
    <TextField select label={t('board.filters.period')} value={filters.period}
      onChange={(event) => updateFilter('period', event.target.value as TaskPeriod)}>
      {(['all', 'overdue', 'today', 'week', 'custom'] as const).map((period) =>
        <MenuItem value={period} key={period}>{t(`board.period.${period}`)}</MenuItem>)}
    </TextField>
    <TextField select label={t('board.filters.crop')} value={filters.crop}
      onChange={(event) => updateFilter('crop', event.target.value)}>
      <MenuItem value="">{t('board.all')}</MenuItem>
      {crops.map((crop) => <MenuItem key={crop.id} value={crop.id}>{formatCropDisplayName(crop)}</MenuItem>)}
    </TextField>
    <TextField select label={t('board.filters.field')} value={filters.field}
      onChange={(event) => updateFilter('field', event.target.value)}>
      <MenuItem value="">{t('board.all')}</MenuItem>
      {fields.map((field) => <MenuItem key={field.id} value={field.id}>{field.name}</MenuItem>)}
    </TextField>
    <TextField select label={t('board.filters.person')} value={filters.person}
      onChange={(event) => updateFilter('person', event.target.value)}>
      <MenuItem value="">{t('board.all')}</MenuItem>
      <MenuItem value="null">{t('board.unassigned')}</MenuItem>
      {members.map((member) => <MenuItem key={member.user} value={member.user}>{member.user_display_name || member.user_email}</MenuItem>)}
    </TextField>
    {filters.period === 'custom' && <>
      <TextField type="date" label={t('board.filters.from')} value={filters.from}
        slotProps={{ inputLabel: { shrink: true } }}
        onChange={(event) => updateFilter('from', event.target.value)} />
      <TextField type="date" label={t('board.filters.to')} value={filters.to} error={invalidRange}
        helperText={invalidRange ? t('board.invalidRange') : undefined}
        slotProps={{ inputLabel: { shrink: true } }}
        onChange={(event) => updateFilter('to', event.target.value)} />
    </>}
    {hasFilters && <Button onClick={() => onFiltersChange({ ...EMPTY_TASK_FILTERS })}>{t('board.resetFilters')}</Button>}
  </Box>;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && isBoardStatus(over.id)) onStatusChange(Number(active.id), over.id);
  };
  const titleOf = (id: string | number) => {
    const task = tasks.find((row) => row.id === Number(id));
    return task ? taskDisplayTitle(task, t) : '';
  };
  return <Box sx={{ minWidth: 0 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
      <Typography component="h1" variant="h5" sx={{ flex: 1 }}>{t('board.title')}</Typography>
      <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate}>
        {t(hasSeason ? 'form.add' : 'form.createSeason')}
      </Button>
    </Stack>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, mb: 2 }}>
      {(['overdue', 'today', 'week'] as const).map((key) => <Paper key={key} variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="h5" component="p">{metrics[key]}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{t(`board.metrics.${key}`)}</Typography>
      </Paper>)}
    </Box>
    {compact ? <Accordion disableGutters elevation={0} sx={{ mb: 2, border: 1, borderColor: 'divider' }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>{t('board.filters.title')}</AccordionSummary>
      <AccordionDetails>{filterControls}</AccordionDetails>
    </Accordion> : <Box sx={{ mb: 2 }}>{filterControls}</Box>}
    {filtered.length === 0 && <Typography color="text.secondary" sx={{ mb: 2 }} role="status">
      {t(hasFilters ? 'board.noMatches' : 'board.empty')}
    </Typography>}
    <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{
      screenReaderInstructions: { draggable: t('board.dragInstructions') },
      announcements: {
        onDragStart: ({ active }) => t('board.dragStarted', { title: titleOf(active.id) }),
        onDragOver: ({ over }) => over && isBoardStatus(over.id) ? t('board.dragOver', { status: t(`board.status.${over.id}`) }) : undefined,
        onDragEnd: ({ active, over }) => over && isBoardStatus(over.id)
          ? t('board.dragEnded', { title: titleOf(active.id), status: t(`board.status.${over.id}`) }) : t('board.dragCancelled'),
        onDragCancel: () => t('board.dragCancelled'),
      },
    }}>
      <Box sx={{ display: 'grid', gap: 2, alignItems: 'start',
        gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))' }}>
        {BOARD_STATUSES.map((status) => {
          const column = filtered.filter((task) => task.status === status);
          return <TaskColumn key={status} status={status} compact={compact} count={column.length}>
            {column.length === 0 && <Typography variant="body2" color="text.secondary">{t('board.emptyColumn')}</Typography>}
            {column.slice(0, limits[status]).map((task) => <TaskCard key={task.id} task={task}
              compact={compact} saving={savingIds.includes(task.id)}
              cropName={task.crop == null ? undefined : formatCropDisplayName(cropById.get(task.crop) ?? {})}
              areaName={fieldById.get(fieldForTask(task))?.name}
              personName={task.assigned_to == null ? undefined : personById.get(task.assigned_to)}
              onStatusChange={onStatusChange} onEdit={onEdit} onDelete={onDelete} />)}
            {column.length > limits[status] && <Button onClick={() => setLimits((previous) => ({
              ...previous, [status]: previous[status] + 30,
            }))}>{t('board.showMore')}</Button>}
          </TaskColumn>;
        })}
      </Box>
    </DndContext>
  </Box>;
}
