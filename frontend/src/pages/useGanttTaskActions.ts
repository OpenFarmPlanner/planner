import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router';
import type { TFunction } from 'i18next';
import { plantingPlanAPI, type PlantingPlan } from '../api/api';
import { extractApiErrorMessage } from '../api/errors';
import { confirmAction } from '../utils/confirmAction';
import { copyTextToClipboardSilently } from '../components/data-grid';
import { plantingPlanDetailPath } from '../planting-plans/plantingPlanDetailRoutes';
import {
  formatCropDisplayLabel,
  formatGanttDate,
  type GanttTask,
  type GanttTaskGroup,
} from './ganttChartUtils';

interface UseGanttTaskActionsParams {
  navigate: NavigateFunction;
  plantingPlans: PlantingPlan[];
  setPlantingPlans: Dispatch<SetStateAction<PlantingPlan[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  t: TFunction;
}

/**
 * The Gantt chart's task/group navigation and edit actions: open the plan,
 * crop, or areas page; copy a task summary; add or delete a plan. Bundled
 * so both the double-click handler and the context menu can share them.
 */
export function useGanttTaskActions({
  navigate,
  plantingPlans,
  setPlantingPlans,
  setError,
  t,
}: UseGanttTaskActionsParams) {
  const openPlantingPlanFromTask = useCallback((task: GanttTask, options?: { edit?: boolean; details?: boolean }) => {
    if (task.plantingPlanId) {
      if (options?.details) {
        void navigate(plantingPlanDetailPath(task.plantingPlanId));
        return;
      }
      const query = options?.edit ? `planId=${task.plantingPlanId}&edit=true` : `planId=${task.plantingPlanId}`;
      navigate(`/app/planting-plans?${query}`);
      return;
    }
    navigate('/app/planting-plans');
  }, [navigate]);

  // Stable (task) => void wrapper so it can be passed directly as a
  // GanttChartProps callback without a fresh inline arrow on every render.
  const handleTaskDoubleClickToPlan = useCallback((task: GanttTask) => {
    openPlantingPlanFromTask(task);
  }, [openPlantingPlanFromTask]);

  const openCropFromTask = useCallback((task: GanttTask) => {
    const plan = plantingPlans.find((entry) => entry.id === task.plantingPlanId);
    if (plan?.crop) {
      navigate(`/app/crops?cropId=${plan.crop}`);
    }
  }, [navigate, plantingPlans]);

  const addPlantingPlanForBed = useCallback((group: GanttTaskGroup) => {
    if (group.bedId) {
      navigate(`/app/planting-plans?bedId=${group.bedId}&create=true`);
    }
  }, [navigate]);

  // Navigates to the areas (Anbauflächen) page and, if a target is given,
  // deep-links to the matching Standort/Parzelle/Beet row: FieldsBedsHierarchy
  // expands its ancestors, scrolls it into view, and briefly flashes it.
  const openAreasPage = useCallback((highlight?: { type: 'location' | 'field' | 'bed'; id: number }) => {
    navigate(highlight ? `/app/fields-beds?highlight=${highlight.type}:${highlight.id}` : '/app/fields-beds');
  }, [navigate]);

  const copyTaskSummary = useCallback((task: GanttTask, group: GanttTaskGroup) => {
    const parts = [
      task.cropName ? formatCropDisplayLabel(task.cropName, task.cropVariety) : task.name,
      group.name,
      `${formatGanttDate(task.startDate)} – ${formatGanttDate(task.endDate)}`,
    ].filter(Boolean);
    copyTextToClipboardSilently(parts.join(' · '));
  }, []);

  const deletePlantingPlanFromTask = useCallback(async (task: GanttTask) => {
    if (!task.plantingPlanId) return;
    const confirmed = confirmAction(t('ganttChart:contextMenu.confirmDeletePlan'));
    if (!confirmed) return;
    try {
      await plantingPlanAPI.delete(task.plantingPlanId);
      setPlantingPlans((previous) => previous.filter((entry) => entry.id !== task.plantingPlanId));
    } catch (err) {
      setError(extractApiErrorMessage(err, t, t('ganttChart:errors.updatePlan')));
    }
  }, [setError, setPlantingPlans, t]);

  return {
    openPlantingPlanFromTask,
    handleTaskDoubleClickToPlan,
    openCropFromTask,
    addPlantingPlanForBed,
    openAreasPage,
    copyTaskSummary,
    deletePlantingPlanFromTask,
  };
}
