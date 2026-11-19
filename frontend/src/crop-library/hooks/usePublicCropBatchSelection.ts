import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { PublicCrop } from '../../api/types';
import { buildCropHierarchy } from '../../crops/cropHierarchy';
import { isBatchImportParent } from '../batchImport';

export interface PublicCropBatchSelection {
  selected: ReadonlyMap<number, PublicCrop>;
  toggleCrop: (crop: PublicCrop, checked: boolean) => void;
}

export function usePublicCropBatchSelection(projectId: number | null | undefined, visibleCrops: PublicCrop[]) {
  const [selection, setSelection] = useState<{ projectId: number; crops: Map<number, PublicCrop> } | null>(null);
  const [preview, setPreview] = useState<{ projectId: number; parents: PublicCrop[] } | null>(null);
  const [previousProject, setPreviousProject] = useState(projectId);
  const iconRef = useRef<HTMLButtonElement | null>(null);
  const attachIcon = useCallback((icon: HTMLButtonElement | null) => { iconRef.current = icon; }, []);
  const controlsId = useId();
  const selected = selection?.projectId === projectId ? selection?.crops : undefined;
  const selecting = Boolean(selected);
  const visibleParents = useMemo(() => selecting ? buildCropHierarchy(visibleCrops)
    .flatMap(item => item.kind === 'species' && isBatchImportParent(item.crop) ? [item.crop] : []) : [], [selecting, visibleCrops]);
  const selectedVisible = visibleParents.filter(crop => selected?.has(crop.id)).length;
  if (previousProject !== projectId) {
    setPreviousProject(projectId);
    setSelection(null);
    setPreview(null);
  }

  const toggleCrops = (crops: PublicCrop[], checked: boolean) => {
    setSelection(current => {
      if (!current || current.projectId !== projectId) return current;
      const next = new Map(current.crops);
      for (const crop of crops) {
        if (checked) next.set(crop.id, crop);
        else next.delete(crop.id);
      }
      return { ...current, crops: next };
    });
  };

  const clear = useCallback(() => {
    setSelection(null);
    setPreview(null);
  }, []);

  const cancel = () => {
    clear();
    requestAnimationFrame(() => iconRef.current?.focus({ preventScroll: true }));
  };

  return {
    attachIcon, controlsId, selectedVisible, visibleParents,
    selection: selected ? { selected, toggleCrop: (crop: PublicCrop, checked: boolean) => toggleCrops([crop], checked) } : undefined,
    preview: preview?.projectId === projectId ? preview : null,
    canSelect: Boolean(projectId),
    toggleMode: () => { if (selected) cancel(); else if (projectId) setSelection({ projectId, crops: new Map() }); },
    toggleVisible: () => toggleCrops(visibleParents, selectedVisible < visibleParents.length),
    openPreview: () => { if (selected?.size && projectId) setPreview({ projectId, parents: [...selected.values()] }); },
    closePreview: () => setPreview(null),
    clear,
    cancel,
  };
}

export type PublicCropBatchSelectionControls = ReturnType<typeof usePublicCropBatchSelection>;
