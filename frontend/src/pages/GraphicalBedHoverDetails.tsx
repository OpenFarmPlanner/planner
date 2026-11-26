import { Box, Stack, Typography } from '@mui/material';
import type { Task } from '../api/types';
import { bedTaskDueUrgency, bedTaskUrgencyLabel, type bedTaskDateBounds } from '../components/tasks/bedTaskUrgency';
import { taskDisplayTitle } from '../components/tasks/taskTitles';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { bedCropDisplayName, bedCropPhaseLabel, type BedCultivationEntry } from './graphicalCultivation';

interface Props {
  tasks: readonly Task[];
  taskLoading: boolean;
  taskFailed: boolean;
  taskBounds: ReturnType<typeof bedTaskDateBounds>;
  taskLimit?: number;
  noOpenTasksLabel?: string;
  crops?: readonly BedCultivationEntry[];
  cropLoading: boolean;
  cropFailed: boolean;
}

export function GraphicalBedHoverDetails({
  tasks, taskLoading, taskFailed, taskBounds, taskLimit = 3, noOpenTasksLabel, crops, cropLoading, cropFailed,
}: Props) {
  const { t, i18n } = useTranslation(['fields', 'dashboard', 'common', 'ganttChart']);
  const locale = resolveSeasonDateLocale(i18n);
  const more = tasks.length - taskLimit;
  const namedCrops = crops?.filter(({ plan }) => plan.name || plan.crop !== null) ?? [];
  const growPhase = crops?.length === 1 ? bedCropPhaseLabel(crops[0], t) : null;
  const cropNames = namedCrops.slice(0, 2).map(({ plan }) => bedCropDisplayName(plan, t)).join(', ');
  const moreCrops = namedCrops.length > 2 ? ` +${namedCrops.length - 2}` : '';
  return (
    <Stack spacing={0.25} sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
      {(cropLoading || taskLoading) && <Typography variant="caption">{t('common:messages.loading')}</Typography>}
      {cropFailed && <Typography variant="caption" color="error.main">{t('graphical.display.cropLoadError')}</Typography>}
      {!!cropNames && <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap>{cropNames}{moreCrops}</Typography>}
      {growPhase && <Typography variant="caption" color="text.secondary">{growPhase}</Typography>}
      {taskFailed && <Typography variant="caption" color="error.main">{t('graphical.taskLayer.loadError')}</Typography>}
      {!taskLoading && !taskFailed && (
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {tasks.length ? t('graphical.taskLayer.outstanding', { count: tasks.length }) : noOpenTasksLabel ?? t('graphical.objects.noOpenTasks')}
        </Typography>
      )}
      {tasks.length > 0 && <Stack component="ul" spacing={0.25} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {tasks.slice(0, taskLimit).map(task => (
          <Box component="li" key={task.id}>
            <Typography variant="caption" component="div" noWrap>{taskDisplayTitle(task, t)}</Typography>
            <Typography variant="caption" component="div" color="text.secondary">
              {task.due_date ? `${bedTaskUrgencyLabel(bedTaskDueUrgency(task.due_date, taskBounds), t)} · ${formatSeasonDate(task.due_date, locale)}`
                : t('dashboard:board.noDate')}
            </Typography>
          </Box>
        ))}
      </Stack>}
      {more > 0 && <Typography variant="caption" color="text.secondary">{t('graphical.objects.moreTasks', { count: more })}</Typography>}
    </Stack>
  );
}
