/**
 * Turns a stored notification into what the UI shows and where it links.
 *
 * The backend deliberately ships `notification_type` + `context` instead of a
 * ready-made sentence (its own `message` field stays English for the admin and
 * non-UI consumers), so the localized text is assembled here.
 */

import type { TFunction } from 'i18next';
import type { AppNotification, PublicCropFieldChange } from '../api/types';
import { formatPublicCropFieldChanges } from '../crop-library/components/publicCropLibrary/formatters';

/**
 * `context`, with any `changed_fields` diff rendered into a `changes` string.
 *
 * i18next interpolates scalars, not arrays of objects, so a notification that
 * wants to name the changes inline needs them pre-rendered. They go through
 * the crop library's own diff formatter (`tCrops` resolves its `crops`
 * namespace keys) rather than a second set of field labels.
 */
function buildMessageContext(
  notification: AppNotification,
  tCrops: TFunction,
): Record<string, unknown> {
  const context = notification.context ?? {};
  const changedFields = (context as { changed_fields?: unknown }).changed_fields;
  if (!Array.isArray(changedFields) || changedFields.length === 0) {
    return context;
  }
  return {
    ...context,
    changes: formatPublicCropFieldChanges(changedFields as PublicCropFieldChange[], tCrops),
  };
}

export function getNotificationMessage(
  notification: AppNotification,
  t: TFunction,
  tCrops: TFunction,
): string {
  return t(`messages.${notification.notification_type}`, {
    ...buildMessageContext(notification, tCrops),
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
    case 'crop':
      // The project's own crop list, where the affected Sorte is selected.
      return `/app/crops?cropId=${notification.target_id}`;
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
