import { useEffect, useRef, useState } from 'react';

export function useDialogSaveFeedback() {
  const [failureAttempt, setFailureAttempt] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!failureAttempt) return;
    // Scroll only the dialog, including when an unchanged validation error recurs.
    if (contentRef.current) contentRef.current.scrollTop = 0;
    errorRef.current?.focus({ preventScroll: true });
  }, [failureAttempt]);

  return {
    failed: failureAttempt > 0,
    showFailure: () => setFailureAttempt(previous => previous + 1),
    clearFailure: () => setFailureAttempt(0),
    contentRef,
    errorRef,
  };
}
