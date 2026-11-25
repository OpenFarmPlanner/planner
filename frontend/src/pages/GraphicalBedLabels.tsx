import { useTheme } from '@mui/material/styles';
import { Circle, Text } from 'react-konva';
import type { Task } from '../api/types';
import { bedTaskUrgencyLabel, type BedTaskUrgency } from '../components/tasks/bedTaskUrgency';
import { taskDisplayTitle } from '../components/tasks/taskTitles';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import type { BedViewModel } from './graphicalFieldsGeometry';
import { FIELD_INNER_OFFSET_X, FIELD_INNER_OFFSET_Y } from './graphicalFieldsGeometry';
import { bedTaskColors, BED_TASK_SYMBOLS } from './graphicalBedTaskStyle';
import { includesCrops, includesTasks, type BedCultivationEntry, type GraphicalDisplayMode } from './graphicalCultivation';
import { getBedLabelLayout } from './graphicalViewport';

interface Props {
  bed: BedViewModel;
  scale: number;
  mode: GraphicalDisplayMode;
  detailedArea: boolean;
  crops: readonly BedCultivationEntry[];
  tasks: readonly Task[];
  urgency?: BedTaskUrgency | null;
}

export function GraphicalBedLabels({ bed, scale, mode, detailedArea, crops, tasks, urgency }: Props) {
  const { t, i18n } = useTranslation(['fields', 'dashboard', 'common', 'ganttChart']);
  const theme = useTheme();
  const width = bed.width * scale;
  const height = bed.height * scale;
  const origin = { x: FIELD_INNER_OFFSET_X + bed.x, y: FIELD_INNER_OFFSET_Y + bed.y };
  const showTasks = includesTasks(mode) && tasks.length > 0 && urgency && urgency !== 'completed';
  const badge = showTasks ? BED_TASK_SYMBOLS[urgency] : null;
  const colors = showTasks ? bedTaskColors(theme, urgency) : null;
  const badgeText = badge && width >= 78 ? `${badge} ${tasks.length}` : badge;
  const badgeWidth = badgeText && width >= 44 && height >= 20 ? badgeText.length * 7 + 7 : 0;
  const label = getBedLabelLayout({ ...bed, width: bed.width - badgeWidth / scale }, scale);
  const maxRows = width >= 64 ? Math.max(1, Math.floor((height - 8) / 15)) : 1;
  const cropList = includesCrops(mode) ? crops : [];
  const names = cropList.map(({ plan }) => {
    const name = plan.name || t('ganttChart:taskNames.unknownCrop', { id: plan.crop ?? '' });
    return width >= 160 && plan.variety ? `${name} (${plan.variety})` : name;
  });
  const locale = resolveSeasonDateLocale(i18n);
  const phase = cropList.length === 1 ? cropList[0].phase : null;
  const rows: { kind: string; text: string }[] = [];
  if (maxRows >= 2 && names.length) rows.push({
    kind: 'crop',
    text: names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', '),
  });
  if (maxRows >= 3 && width >= 114 && phase) {
    const item = cropList[0];
    const label = t(item.recordedHarvest ? 'graphical.display.recordedHarvest' : `graphical.display.phase.${phase}`);
    const period = item.harvest;
    rows.push({ kind: 'phase', text: period
      ? `${label} · ${formatSeasonDate(period.start_date, locale)}` : label });
  }
  if (maxRows >= 3 && width >= 104 && showTasks) {
    const available = maxRows - rows.length - 1;
    const needsMoreRow = available > 1 && tasks.length > Math.min(2, available);
    const taskCount = Math.min(2, available - Number(needsMoreRow));
    for (const task of tasks.slice(0, taskCount)) {
      const title = taskDisplayTitle(task, t);
      rows.push({ kind: 'task', text: task.due_date && width >= 160
        ? `${title} · ${formatSeasonDate(task.due_date, locale)}` : title });
    }
    if (needsMoreRow) rows.push({
      kind: 'more-tasks', text: t('graphical.objects.moreTasks', { count: tasks.length - taskCount }),
    });
  }
  const hasRows = rows.length > 0;
  const radius = Math.min(3 / scale, bed.width / 5, bed.height / 5);

  return (
    <>
      {badgeWidth > 0 && badgeText && (
        <Text x={origin.x + bed.width - badgeWidth / scale} y={origin.y + 4 / scale}
          width={badgeWidth - 2} height={14} align="right" text={badgeText}
          fontSize={12} fontStyle="bold" fill={colors?.glyph}
          listening={false} scaleX={1 / scale} scaleY={1 / scale}
          aria-label={urgency ? bedTaskUrgencyLabel(urgency, t) : undefined}
          data-testid={`bed-task-icon-${bed.id}`} />
      )}
      {showTasks && badgeWidth === 0 && (
        <Circle x={origin.x + bed.width - radius * 1.4} y={origin.y + radius * 1.4}
          radius={radius} fill={colors?.glyph} listening={false} data-testid={`bed-task-dot-${bed.id}`} />
      )}
      {label && (
        <Text x={origin.x + label.x} y={origin.y + (hasRows ? 4 / scale : label.y)}
          text={detailedArea && !hasRows && !names.length && !showTasks && !label.compact
            ? `${bed.name} (${bed.area || '-'} ${t('common:units.squareMeters')})` : bed.name}
          fontSize={label.fontSize} width={label.width} height={label.height} rotation={label.rotation}
          lineHeight={1} wrap="none" ellipsis listening={false} scaleX={1 / scale} scaleY={1 / scale}
          data-testid={`bed-label-${bed.id}`} />
      )}
      {label && rows.map(({ kind, text }, index) => (
        <Text key={index} x={origin.x + 4 / scale} y={origin.y + (19 + index * 15) / scale}
          text={text} fontSize={11} width={Math.max(0, width - 8)} height={12}
          lineHeight={1} wrap="none" ellipsis listening={false} scaleX={1 / scale} scaleY={1 / scale}
          data-testid={`bed-${kind}-label-${bed.id}-${index}`} />
      ))}
    </>
  );
}
