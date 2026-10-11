import { useEffect, useRef, useState } from 'react';
import { useLocation, useRouteError } from 'react-router';
import RuntimeErrorState from './RuntimeErrorState';
import {
  isDynamicImportLoadError,
  recoverUnlessPageIsUnloading,
  reloadPage,
  routeLoadRetryIsAvailable,
  shouldAutomaticallyReloadForRouteLoadError,
} from '../../runtime/chunkLoadErrors';

export default function RouteErrorBoundary() {
  const error = useRouteError();
  const location = useLocation();
  const isApplicationUpdateError = isDynamicImportLoadError(error);
  const routeKey = `${location.pathname}${location.search}`;
  // Seed synchronously from a read-only peek so a permanently broken chunk
  // (retry budget already spent on the previous load) paints the fallback on
  // the first render instead of flashing a blank screen for one frame. The
  // budget itself is still claimed exactly once, in the effect below.
  const [isReloading, setIsReloading] = useState(
    () => isApplicationUpdateError && routeLoadRetryIsAvailable(routeKey),
  );
  // StrictMode invokes effects twice in development; the ref plus the
  // session-storage guard keep the reload to a single attempt.
  const hasClaimedRetryRef = useRef(false);

  useEffect(() => {
    if (!isApplicationUpdateError || hasClaimedRetryRef.current) {
      return;
    }

    hasClaimedRetryRef.current = true;
    recoverUnlessPageIsUnloading(() => {
      if (shouldAutomaticallyReloadForRouteLoadError(routeKey)) {
        reloadPage();
        return;
      }

      setIsReloading(false);
    });
  }, [isApplicationUpdateError, routeKey]);

  if (isReloading) {
    return null;
  }

  return <RuntimeErrorState variant={isApplicationUpdateError ? 'applicationUpdated' : 'routeError'} />;
}
