/**
 * `window.confirm` is a native browser dialog, so its button focus and
 * Enter/Escape behavior are controlled entirely by the browser/OS and can't
 * be made to follow the app's "default focus on Cancel, Enter never
 * confirms a destructive action" policy (see ConfirmationDialog).
 * Existing call sites retain this wrapper for backward-compatible behavior.
 * New destructive confirmation flows should use `ConfirmationDialog`.
 */
export function confirmAction(message: string): boolean {
  return window.confirm(message);
}
