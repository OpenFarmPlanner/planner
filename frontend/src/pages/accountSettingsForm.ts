// Non-component form helpers for the account settings page: the shared action
// button width style and the per-section submit-state hook.

import { useState } from 'react';
import { showGlobalSnackbar } from '../utils/globalSnackbar';

export { settingsActionButtonSx as actionButtonSx } from '../components/settings/settingsStyles';

/** Submit state of one settings form: success goes to the global snackbar, errors stay at the form. */
export interface SectionSubmit {
  error: string | null;
  submitting: boolean;
  submit: (action: () => Promise<{ detail: string }>, onSuccess?: () => void | Promise<void>) => Promise<void>;
  clearError: () => void;
}

export function useSectionSubmit(genericErrorMessage: string): SectionSubmit {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (
    action: () => Promise<{ detail: string }>,
    onSuccess?: () => void | Promise<void>,
  ): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await action();
      showGlobalSnackbar({ message: response.detail, severity: 'success' });
      await onSuccess?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : genericErrorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  return { error, submitting, submit, clearError: () => setError(null) };
}
