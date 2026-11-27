import { useId, useMemo, useRef, useState } from 'react';
import type { Crop, CropBulkDeleteSelection } from '../api/types';
import { buildCropHierarchy } from './cropHierarchy';

export type CropDeletionTarget = Pick<CropBulkDeleteSelection, 'expected_project_id'> & {
  scope: 'selected';
  crop_ids: number[];
};

function cropGroupSelection(crops: readonly Crop[]) {
  const varietiesByParent = new Map<number, number[]>();
  const parentByRow = new Map<string, number>();
  for (const node of buildCropHierarchy(crops)) {
    const id = node.crop?.id;
    if (id === undefined) continue;
    if (node.kind === 'species' && node.varietyCount > 0) {
      parentByRow.set(node.id, id);
      varietiesByParent.set(id, []);
    } else if (node.parentId !== null) {
      const parentId = parentByRow.get(node.parentId);
      if (parentId !== undefined) varietiesByParent.get(parentId)?.push(id);
    }
  }
  return varietiesByParent;
}

function removeIncompleteParents(ids: Set<number>, groups: ReadonlyMap<number, readonly number[]>) {
  for (const [parent, varieties] of groups) {
    if (ids.has(parent) && varieties.some(id => !ids.has(id))) ids.delete(parent);
  }
  return ids;
}

export function useProjectCropSelection(projectId: number | null | undefined, crops: readonly Crop[]) {
  const groups = useMemo(() => cropGroupSelection(crops), [crops]);
  const [selection, setSelection] = useState<{ project: number; ids: ReadonlySet<number> } | null>(null);
  const [target, setTarget] = useState<CropDeletionTarget | null>(null);
  const [previous, setPrevious] = useState({ projectId, groups });
  const selectionButton = useRef<HTMLButtonElement>(null);
  const controlsId = useId();
  const selected = selection && selection.project === projectId ? selection.ids : null;
  const colorResetSelection = selected?.size ? crops.flatMap(crop => (
    crop.id !== undefined && selected.has(crop.id) && crop.updated_at && crop.variety?.trim()
      && (crop.display_color_override === undefined ? crop.display_color : crop.display_color_override)
      ? [{ id: crop.id, updated_at: crop.updated_at }]
      : []
  )) : [];

  if (previous.projectId !== projectId || previous.groups !== groups) {
    setPrevious({ projectId, groups });
    if (previous.projectId !== projectId) {
      setSelection(null);
      setTarget(null);
    } else if (selection) {
      const ids = removeIncompleteParents(new Set(selection.ids), groups);
      if (ids.size !== selection.ids.size) setSelection({ ...selection, ids });
    }
  }

  const cancel = () => {
    setSelection(null);
    requestAnimationFrame(() => selectionButton.current?.focus({ preventScroll: true }));
  };

  const setSelected = (ids: readonly number[], checked: boolean) => {
    setSelection(current => {
      if (!current || current.project !== projectId) return current;
      const next = new Set(current.ids);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { ...current, ids: removeIncompleteParents(next, groups) };
    });
  };

  return {
    selected, colorResetSelection, selectionButton, controlsId, setSelected, cancel,
    isMixed: (id: number) => Boolean(selected && !selected.has(id)
      && groups.get(id)?.some(variety => selected.has(variety))),
    setCropSelected: (id: number, checked: boolean) => setSelected([id, ...(groups.get(id) ?? [])], checked),
    eligibleVisibleIds: (ids: readonly number[]) => {
      // Use one scope for selecting and clearing. A parent belongs to that
      // scope only when the filters also include its whole group.
      const visible = new Set(ids);
      return [...visible].filter(id => groups.get(id)?.every(variety => visible.has(variety)) ?? true);
    },
    enabled: projectId != null,
    target: target?.expected_project_id === projectId ? target : null,
    toggle: () => {
      if (selected) cancel();
      else if (projectId != null) setSelection({ project: projectId, ids: new Set() });
    },
    openSelected: () => {
      if (projectId != null && selected?.size) {
        setTarget({ expected_project_id: projectId, scope: 'selected', crop_ids: [...selected] });
      }
    },
    closeTarget: () => setTarget(null),
    completeTarget: () => {
      setTarget(null);
      setSelection(null);
    },
  };
}

export type ProjectCropSelection = ReturnType<typeof useProjectCropSelection>;
