import { useEffect } from 'react';

/** Protect unsaved edits through a reload or tab close, independently of routing. */
export function useBeforeUnloadProtection(shouldBlock: boolean, message: string): void {
  useEffect(() => {
    if (!shouldBlock) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers display their own prompt instead of the supplied message.
      event.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldBlock, message]);
}
