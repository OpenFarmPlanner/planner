import { useId, useRef, useState } from 'react';
import type { CropBulkDeleteSelection } from '../api/types';

export type CropDeletionTarget = Pick<CropBulkDeleteSelection, 'expected_project_id'> & {
  scope: 'selected';
  crop_ids: number[];
};

export function useProjectCropSelection(projectId: number | null | undefined) {
  const [selection, setSelection] = useState<{ project: number; ids: ReadonlySet<number> } | null>(null);
  const [target, setTarget] = useState<CropDeletionTarget | null>(null);
  const [previousProject, setPreviousProject] = useState(projectId);
  const selectionButton = useRef<HTMLButtonElement>(null);
  const controlsId = useId();
  const selected = selection && selection.project === projectId ? selection.ids : null;

  if (previousProject !== projectId) {
    setPreviousProject(projectId);
    setSelection(null);
    setTarget(null);
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
      return { ...current, ids: next };
    });
  };

  return {
    selected, selectionButton, controlsId, setSelected, cancel,
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
