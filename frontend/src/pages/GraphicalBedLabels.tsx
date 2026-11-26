import { Fragment } from 'react';
import { useTheme } from '@mui/material/styles';
import { Circle, Text } from 'react-konva';
import type { Task } from '../api/types';
import { bedTaskUrgencyLabel, type BedTaskUrgency } from '../components/tasks/bedTaskUrgency';
import { taskDisplayTitle } from '../components/tasks/taskTitles';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import type { BedViewModel } from './graphicalFieldsGeometry';
import { bedTaskColors, BED_TASK_SYMBOLS } from './graphicalBedTaskStyle';
import { bedCropDisplayName, bedCropPhaseLabel, includesCrops, includesTasks, type BedCultivationEntry, type GraphicalDisplayMode } from './graphicalCultivation';
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
  const origin = { x: 0, y: 0 };
  const showTasks = includesTasks(mode) && tasks.length > 0 && urgency && urgency !== 'completed';
  const badge = showTasks ? BED_TASK_SYMBOLS[urgency] : null;
  const colors = showTasks ? bedTaskColors(theme, urgency) : null;
  const badgeText = badge && width >= 64 ? `${badge} ${tasks.length}` : badge;
  const badgeWidth = badgeText && width >= 44 && height >= 20 ? badgeText.length * 7 + 7 : 0;
  const label = getBedLabelLayout({ ...bed, width: bed.width - badgeWidth / scale }, scale);
  const detailRows = width >= 64 ? Math.max(0, Math.floor((height - 20) / 15)) : 0;
  const cropList = includesCrops(mode) ? crops.filter(({ plan }) => plan.name || plan.crop !== null) : [];
  const names = cropList.slice(0, 2).map(({ plan }) => bedCropDisplayName(plan, t, width >= 160));
  const locale = resolveSeasonDateLocale(i18n);
  const phase = cropList.length === 1 && crops.length === 1 ? bedCropPhaseLabel(cropList[0], t) : null;
  const rows: { kind: string; text: string; due?: string }[] = [];
  if (detailRows >= 1 && names.length) rows.push({
    kind: 'crop',
    text: `${names.join(', ')}${cropList.length > 2 ? ` +${cropList.length - 2}` : ''}`,
  });
  if (detailRows >= 2 && width >= 114 && phase) {
    const period = cropList[0].harvest;
    rows.push({ kind: 'phase', text: period
      ? `${phase} · ${formatSeasonDate(period.start_date, locale)}` : phase });
  }
  const available = detailRows - rows.length;
  if (available > 0 && width >= 150 && showTasks) {
    const needsMoreRow = tasks.length > Math.min(2, available);
    const taskCount = Math.min(2, available - Number(needsMoreRow));
    for (const task of tasks.slice(0, taskCount)) {
      rows.push({ kind: 'task', text: taskDisplayTitle(task, t),
        due: task.due_date ? formatSeasonDate(task.due_date, locale) : t('dashboard:board.noDate') });
    }
    if (taskCount > 0 && needsMoreRow) rows.push({
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
          aria-label={urgency ? `${bedTaskUrgencyLabel(urgency, t)} · ${t('graphical.taskLayer.outstanding', { count: tasks.length })}` : undefined}
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
      {label && rows.map(({ kind, text, due }, index) => {
        const dueWidth = due ? Math.min(due.length * 7, width * 0.45) : 0;
        const y = origin.y + (19 + index * 15) / scale;
        return (
          <Fragment key={index}>
            <Text x={origin.x + 4 / scale} y={y}
              text={text} fontSize={11} width={width - (due ? 12 : 8) - dueWidth} height={12}
              lineHeight={1} wrap="none" ellipsis listening={false} scaleX={1 / scale} scaleY={1 / scale}
              data-testid={`bed-${kind}-label-${bed.id}-${index}`} />
            {due && <Text x={origin.x + (width - 4 - dueWidth) / scale} y={y}
              text={due} fontSize={11} width={dueWidth} height={12} align="right"
              lineHeight={1} wrap="none" ellipsis listening={false} scaleX={1 / scale} scaleY={1 / scale}
              data-testid={`bed-task-due-${bed.id}-${index}`} />}
          </Fragment>
        );
      })}
    </>
  );
}
