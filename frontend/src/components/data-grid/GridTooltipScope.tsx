import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createGridTooltipScope, GridTooltipContext, trackGridTooltipPointer } from './gridTooltipState';

const NAVIGATION_KEYS = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function GridTooltipScope({ editing, children }: { editing: boolean; children: ReactNode }) {
  const [scope] = useState(() => createGridTooltipScope(editing));
  useLayoutEffect(() => scope.setEditing(editing), [editing, scope]);

  useLayoutEffect(() => {
    const stopTrackingPointer = trackGridTooltipPointer(document);
    const onNavigationKey = (event: KeyboardEvent): void => {
      if (!scope.isEditing() && NAVIGATION_KEYS.has(event.key) && event.target instanceof Element
          && !event.target.closest('.MuiModal-root, [data-grid-dedicated-editor]')) {
        scope.allowFocus();
      }
    };
    document.addEventListener('keydown', onNavigationKey, true);
    return () => {
      document.removeEventListener('keydown', onNavigationKey, true);
      stopTrackingPointer();
      scope.dispose();
    };
  }, [scope]);

  return <GridTooltipContext.Provider value={scope}>{children}</GridTooltipContext.Provider>;
}
