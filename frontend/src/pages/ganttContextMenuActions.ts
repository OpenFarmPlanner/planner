import type { TFunction } from "i18next";
import type { GanttTask, GanttTaskGroup } from "./ganttChartUtils";

export type GanttContextMenuTarget =
  | { type: "task"; task: GanttTask; group: GanttTaskGroup }
  | { type: "group"; group: GanttTaskGroup };

export interface GanttContextMenuAction {
  id: string;
  label: string;
  group: "navigate" | "edit" | "danger";
  onClick: () => void;
}

export interface GanttContextMenuCallbacks {
  openPlantingPlanFromTask: (task: GanttTask, options?: { edit?: boolean; details?: boolean }) => void;
  openCropFromTask: (task: GanttTask) => void;
  openAreasPage: (highlight?: { type: "location" | "field" | "bed"; id: number }) => void;
  copyTaskSummary: (task: GanttTask, group: GanttTaskGroup) => void;
  deletePlantingPlanFromTask: (task: GanttTask) => void | Promise<void>;
  addPlantingPlanForBed: (group: GanttTaskGroup) => void;
  openOriginSeasonFromTask?: (task: GanttTask) => void;
}

/**
 * Builds the context-menu action list for a Gantt task or group target. Pure:
 * the returned actions' onClick handlers delegate to the supplied callbacks, so
 * this can be unit-tested without rendering the chart.
 */
export function buildGanttContextMenuActions(
  target: GanttContextMenuTarget,
  callbacks: GanttContextMenuCallbacks,
  t: TFunction,
): GanttContextMenuAction[] {
  const {
    openPlantingPlanFromTask,
    openCropFromTask,
    openAreasPage,
    copyTaskSummary,
    deletePlantingPlanFromTask,
    addPlantingPlanForBed,
    openOriginSeasonFromTask,
  } = callbacks;

  if (target.type === "task") {
    const { task, group } = target;
    const actions: GanttContextMenuAction[] = [
      { id: "open-plan", label: t("ganttChart:contextMenu.openPlan"), group: "navigate", onClick: () => openPlantingPlanFromTask(task) },
    ];
    if (task.plantingPlanId) {
      actions.push({ id: "plan-details", label: t("plantingPlans:details.title"), group: "navigate", onClick: () => openPlantingPlanFromTask(task, { details: true }) });
    }
    if (task.cropName) {
      actions.push({ id: "open-crop", label: t("ganttChart:contextMenu.openCrop"), group: "navigate", onClick: () => openCropFromTask(task) });
    }
    if (group.bedId) {
      const bedId = group.bedId;
      actions.push({ id: "open-bed", label: t("ganttChart:contextMenu.openBed"), group: "navigate", onClick: () => openAreasPage({ type: "bed", id: bedId }) });
    }
    if (group.fieldId) {
      const fieldId = group.fieldId;
      actions.push({ id: "open-field", label: t("ganttChart:contextMenu.openField"), group: "navigate", onClick: () => openAreasPage({ type: "field", id: fieldId }) });
    }
    if (group.locationId) {
      const locationId = group.locationId;
      actions.push({ id: "open-location", label: t("ganttChart:contextMenu.openLocation"), group: "navigate", onClick: () => openAreasPage({ type: "location", id: locationId }) });
    }
    if (task.readOnly) {
      if (task.originSeasonId && task.plantingPlanId && openOriginSeasonFromTask) {
        actions.push({ id: "open-origin", label: t("plantingPlans:carriedOver.openOrigin"),
          group: "navigate", onClick: () => openOriginSeasonFromTask(task) });
      }
    } else {
      actions.push({ id: "edit", label: t("common:actions.edit"), group: "edit",
        onClick: () => openPlantingPlanFromTask(task, { edit: true }) });
    }
    actions.push({ id: "copy", label: t("common:actions.copyRow"), group: "edit",
      onClick: () => copyTaskSummary(task, group) });
    if (!task.readOnly) {
      actions.push({ id: "delete", label: t("common:actions.delete"), group: "danger",
        onClick: () => { void deletePlantingPlanFromTask(task); } });
    }
    return actions;
  }

  const { group } = target;
  if (group.bedId) {
    const bedId = group.bedId;
    return [
      { id: "open-bed", label: t("ganttChart:contextMenu.openBed"), group: "navigate", onClick: () => openAreasPage({ type: "bed", id: bedId }) },
      { id: "edit-bed", label: t("ganttChart:contextMenu.editBed"), group: "edit", onClick: () => openAreasPage({ type: "bed", id: bedId }) },
      { id: "add-plan", label: t("ganttChart:contextMenu.addPlan"), group: "edit", onClick: () => addPlantingPlanForBed(group) },
    ];
  }
  if (group.fieldId) {
    const fieldId = group.fieldId;
    return [
      { id: "open-field", label: t("ganttChart:contextMenu.openField"), group: "navigate", onClick: () => openAreasPage({ type: "field", id: fieldId }) },
      { id: "edit-field", label: t("ganttChart:contextMenu.editField"), group: "edit", onClick: () => openAreasPage({ type: "field", id: fieldId }) },
    ];
  }
  if (group.locationId) {
    const locationId = group.locationId;
    return [
      { id: "open-location", label: t("ganttChart:contextMenu.openLocation"), group: "navigate", onClick: () => openAreasPage({ type: "location", id: locationId }) },
      { id: "edit-location", label: t("ganttChart:contextMenu.editLocation"), group: "edit", onClick: () => openAreasPage({ type: "location", id: locationId }) },
    ];
  }
  return [];
}
