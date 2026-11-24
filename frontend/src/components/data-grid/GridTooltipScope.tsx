import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createGridTooltipScope, GridTooltipContext, trackGridTooltipInteractions } from './gridTooltipState';

const NAVIGATION_KEYS = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function GridTooltipScope({ editing, children }: { editing: boolean; children: ReactNode }) {
  const [scope] = useState(() => createGridTooltipScope(editing));
  useLayoutEffect(() => scope.setEditing(editing), [editing, scope]);

  useLayoutEffect(() => {
    const stopTracking = trackGridTooltipInteractions(document);
    const onNavigationKey = (event: KeyboardEvent): void => {
      if (!scope.isEditing() && NAVIGATION_KEYS.has(event.key) && event.target instanceof Element
          && !event.target.closest('.MuiModal-root, [data-grid-dedicated-editor]')) {
        scope.allowFocus();
      }
    };
    const onCellPointerDown = (event: MouseEvent): void => {
      if (!scope.isEditing() && event.button === 0 && event.target instanceof Element
          && event.target.closest('[role="gridcell"], [role="columnheader"]')) {
        scope.allowFocus();
      }
    };
    document.addEventListener('keydown', onNavigationKey, true);
    document.addEventListener('mousedown', onCellPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onNavigationKey, true);
      document.removeEventListener('mousedown', onCellPointerDown, true);
      stopTracking();
      scope.dispose();
    };
  }, [scope]);

  return <GridTooltipContext.Provider value={scope}>{children}</GridTooltipContext.Provider>;
}
