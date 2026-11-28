import { useEffect, useRef, useState } from 'react';
import type { GeometryPreviewRequired } from '../../../api/types';
import { GeometryChangeDialog } from './GeometryChangeDialog';
import { registerGeometryChangeHandler } from './geometryChangeBridge';

interface PendingChange {
  request: GeometryPreviewRequired;
  resolve: (confirmed: boolean) => void;
}

/** Mounted once in the app shell so every area save can reach the dialog. */
export function GeometryChangeDialogHost() {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const pendingRef = useRef<PendingChange | null>(null);

  useEffect(() => registerGeometryChangeHandler(request => new Promise<boolean>(resolve => {
    // A second conflict while one is open is declined; the first decision wins.
    if (pendingRef.current) {
      resolve(false);
      return;
    }
    const next = { request, resolve };
    pendingRef.current = next;
    setPending(next);
  })), []);

  if (!pending) return null;
  return (
    <GeometryChangeDialog key={`${pending.request.kind}-${pending.request.id}`} request={pending.request}
      onDone={(confirmed) => {
        pendingRef.current = null;
        setPending(null);
        pending.resolve(confirmed);
      }} />
  );
}
