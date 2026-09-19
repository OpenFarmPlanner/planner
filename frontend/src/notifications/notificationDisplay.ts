/**
 * Turns a stored notification into what the UI shows and where it links.
 *
 * The backend deliberately ships `notification_type` + `context` instead of a
 * ready-made sentence (its own `message` field stays English for the admin and
 * non-UI consumers), so the localized text is assembled here.
 */

import type { TFunction } from 'i18next';
import type { AppNotification } from '../api/types';

export function getNotificationMessage(notification: AppNotification, t: TFunction): string {
  // A decision notification carries its outcome in `context.status`; passing it
  // as the i18next context picks `<type>_approved` / `<type>_rejected` and falls
  // back to the neutral `<type>` key, so the raw enum is never rendered.
  const statusContext = typeof notification.context?.status === 'string' ? notification.context.status : undefined;
  return t(`messages.${notification.notification_type}`, {
    ...notification.context,
    context: statusContext,
    // An unknown type must never render a raw enum value at the user; the
    // English fallback text the backend already stored is the safer default.
    defaultValue: notification.message,
  });
}

/** The full notification history — where both dropdowns link to. */
export const NOTIFICATION_HISTORY_ROUTE = '/app/notifications';

/** In-app route for the referenced object, or `null` when there is nothing to open. */
export function getNotificationLink(notification: AppNotification): string | null {
  if (notification.target_id === null) {
    return null;
  }
  switch (notification.target_type) {
    case 'public_crop':
      return `/app/crop-library?cropId=${notification.target_id}`;
    case 'crop_species':
      // Species have no detail route of their own; the library overview is the
      // closest place the decision is visible.
      return '/app/crop-library';
    case 'public_library_moderation':
      return '/app/public-library-moderation';
    default:
      return null;
  }
}
