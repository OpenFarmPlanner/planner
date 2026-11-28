import { useEffect, useRef, useState } from 'react';
import type { AreaInUse, GeometryPreviewRequired } from '../../../api/types';
import { AreaRetirementDialog } from './AreaRetirementDialog';
import { GeometryChangeDialog } from './GeometryChangeDialog';
import { registerAreaRetirementHandler, registerGeometryChangeHandler } from './geometryChangeBridge';

type PendingRequest =
  | { type: 'change'; request: GeometryPreviewRequired; resolve: (confirmed: boolean) => void }
  | { type: 'retirement'; request: AreaInUse; resolve: (confirmed: boolean) => void };

/** Mounted once in the app shell so every area save or delete can reach its dialog. */
export function GeometryChangeDialogHost() {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);

  useEffect(() => {
    // A second request while one is open is declined; the first decision wins.
    const open = (next: PendingRequest): void => {
      if (pendingRef.current) {
        next.resolve(false);
        return;
      }
      pendingRef.current = next;
      setPending(next);
    };
    const unregisterChange = registerGeometryChangeHandler(request => new Promise<boolean>(
      resolve => open({ type: 'change', request, resolve }),
    ));
    const unregisterRetirement = registerAreaRetirementHandler(request => new Promise<boolean>(
      resolve => open({ type: 'retirement', request, resolve }),
    ));
    return () => {
      unregisterChange();
      unregisterRetirement();
    };
  }, []);

  if (!pending) return null;
  const done = (confirmed: boolean): void => {
    pendingRef.current = null;
    setPending(null);
    pending.resolve(confirmed);
  };
  const key = `${pending.type}-${pending.request.kind}-${pending.request.id}`;
  return pending.type === 'change'
    ? <GeometryChangeDialog key={key} request={pending.request} onDone={done} />
    : <AreaRetirementDialog key={key} request={pending.request} onDone={done} />;
}
