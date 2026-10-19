// Non-component helpers for the project settings members card.

export type ProjectRole = 'admin' | 'member';

/** Feedback shown inside the members card; success also goes to the snackbar. */
export interface MembersFeedback {
  severity: 'warning' | 'error';
  text: string;
}

// Deliberately loose: the backend validates for real; this only catches typos
// before a round trip.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Up to two initials for a member's avatar, from the display name or the email's local part. */
export const memberInitials = (name: string): string => {
  const words = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const initials = words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '?').slice(0, 2);
  return initials.toUpperCase();
};
