import { useEffect, type ReactNode } from 'react';

export function useTopbarWorkspaceControls(
  setControls: ((controls: ReactNode) => void) | undefined,
  controls: ReactNode,
): void {
  useEffect(() => {
    setControls?.(controls);
    return () => setControls?.(null);
  }, [controls, setControls]);
}
