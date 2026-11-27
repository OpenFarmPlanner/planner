import { Link as RouterLink } from 'react-router';
import { Box, Button, Link, Typography } from '@mui/material';
import { useCallback, useMemo } from 'react';
import { projectAPI, taskAPI } from '../../api/api';
import type { Bed, Field, PlantingPlan, Task } from '../../api/types';
import { plantingPlanDetailPath } from '../../planting-plans/plantingPlanDetailRoutes';
import { useTranslation } from '../../i18n';
import { DetailSection } from '../layout/DetailPrimitives';
import { growingAreaPlanTarget, tasksForGrowingArea, type ResolvedGrowingAreaEntity } from '../hierarchy/details/growingAreaEntity';
import { BedTaskList } from './BedTaskList';
import { useScopedRead } from './useBedTasks';

interface AreaTaskSectionProps {
  area: ResolvedGrowingAreaEntity;
  projectId: number | null;
  seasonId?: number;
  fields: Field[];
  beds: Bed[];
  plans: readonly PlantingPlan[];
  plansLoading: boolean;
  plansFailed: boolean;
  retryPlans: () => void;
  canComplete: boolean;
}

export function GrowingAreaTaskSection({
  area, projectId, seasonId, fields, beds, plans, plansLoading, plansFailed, retryPlans, canComplete,
}: AreaTaskSectionProps) {
  const { t } = useTranslation(['fields', 'dashboard', 'hierarchy', 'plantingPlans']);
  const scope = seasonId === undefined ? null : `${projectId}:${seasonId}`;
  const request = useScopedRead(scope, taskAPI.listAll);
  const planById = useMemo(() => new Map(plans.flatMap(plan => plan.id === undefined ? [] : [[plan.id, plan] as const])), [plans]);
  const planIds = useMemo(() => new Set(planById.keys()), [planById]);
  const tasks = useMemo(() => tasksForGrowingArea(request.rows ?? [], planIds, area), [request.rows, planIds, area]);
  const fieldById = useMemo(() => new Map(fields.map(field => [field.id, field])), [fields]);
  const bedById = useMemo(() => new Map(beds.map(bed => [bed.id, bed])), [beds]);
  const loadMembers = useCallback(async (signal: AbortSignal) => ({
    results: (await projectAPI.listMembers(projectId!, signal)).data,
  }), [projectId]);
  const members = useScopedRead(projectId !== null && tasks.some(task => task.assigned_to != null)
    ? String(projectId) : null, loadMembers);
  const personById = useMemo(() => new Map(members.rows?.map(member => [
    member.user, member.user_display_name || member.user_email,
  ])), [members.rows]);
  const renderContext = (task: Task) => {
    const plan = task.planting_plan == null ? undefined : planById.get(task.planting_plan);
    const target = plan ? growingAreaPlanTarget(plan) : { kind: 'field', id: task.field };
    const bed = target?.kind === 'bed' && target.id != null ? bedById.get(target.id) : undefined;
    const fieldId = bed?.field ?? (target?.kind === 'field' ? target.id : null);
    const field = fieldId == null ? undefined : fieldById.get(fieldId);
    const path = [area.location?.name, field?.name, bed?.name].filter(Boolean).join(' / ');
    const person = task.assigned_to == null ? undefined : personById.get(task.assigned_to);
    return (
      <Typography variant="caption" color="text.secondary">
        {path}
        {person && <> · {person}</>}
        {plan?.id !== undefined && <> · <Link component={RouterLink} to={plantingPlanDetailPath(plan.id)} underline="hover">
          {t('plantingPlans:details.title')}
        </Link></>}
      </Typography>
    );
  };
  const failed = request.failed || plansFailed;
  return (
    <Box component="section" aria-label={t('dashboard:board.title')}>
      <DetailSection title={t('dashboard:board.title')}>
        {scope === null ? (
          <Typography variant="body2" color="text.secondary">{t('hierarchy:details.selectTaskSeason')}</Typography>
        ) : plansFailed && !request.failed ? (
          <Typography variant="body2" color="text.secondary" role="status">{t('hierarchy:details.tasksNeedPlans')}</Typography>
        ) : (
          <BedTaskList key={scope} tasks={failed ? [] : tasks} loading={!failed && (plansLoading || request.loading)}
            failed={failed} canComplete={canComplete} renderContext={renderContext}
            noOpenTasksLabel={t('hierarchy:details.noAreaTasks')} loadErrorMessage={t('hierarchy:details.areaTaskLoadError')}
            refresh={() => {
              if (plansFailed) retryPlans();
              request.refresh();
            }} />
        )}
        <Button component={RouterLink} to="/app/dashboard">{t('graphical.taskLayer.allTasks')}</Button>
      </DetailSection>
    </Box>
  );
}
