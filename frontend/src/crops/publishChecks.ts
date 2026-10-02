import axios from 'axios';

import type { PublishBlockingReason, PublishPublicCropPreview } from '../api/types';

type TFunction = (key: string, options?: Record<string, unknown>) => string;

const SPECIES_REASONS: ReadonlySet<PublishBlockingReason> = new Set([
  'missing_crop_species',
  'crop_species_unavailable',
]);

/**
 * The `checks` of a `public_crop_publishing_checks_failed` rejection from
 * `publish-public`, or null for any other error.
 */
export function extractPublishChecks(error: unknown): PublishPublicCropPreview | null {
  if (!axios.isAxiosError(error)) return null;
  const data: unknown = error.response?.data;
  if (
    !data
    || typeof data !== 'object'
    || !('code' in data)
    || data.code !== 'public_crop_publishing_checks_failed'
    || !('checks' in data)
    || !data.checks
    || typeof data.checks !== 'object'
  ) {
    return null;
  }
  return data.checks as PublishPublicCropPreview;
}

/** Whether the checks only pass once an official crop species is chosen. */
export function needsCropSpeciesSelection(checks: Pick<PublishPublicCropPreview, 'blocking_reasons'>): boolean {
  return (checks.blocking_reasons ?? []).some((reason) => SPECIES_REASONS.has(reason));
}

function describeReason(
  reason: PublishBlockingReason,
  checks: PublishPublicCropPreview,
  t: TFunction,
): string | null {
  switch (reason) {
    case 'missing_crop_species':
      return t('library.publishWizard.blockingReasons.missingCropSpecies');
    case 'crop_species_unavailable':
      return t('library.publishWizard.blockingReasons.cropSpeciesUnavailable');
    case 'missing_original_language':
      return t('library.publishWizard.blockingReasons.missingOriginalLanguage');
    case 'missing_required_fields':
      return t('library.publishWizard.requiredFieldsBlocking', {
        fields: (checks.missing_required_fields ?? []).map((item) => t(item.label_key)).join(', '),
      });
    case 'duplicates': {
      const names = (checks.duplicates ?? [])
        .map((entry) => (entry.variety ? `${entry.name} (${entry.variety})` : entry.name))
        .join(', ');
      return names
        ? t('library.publishDuplicateErrorWithCandidates', { duplicates: names })
        : t('library.publishDuplicateError');
    }
    default:
      // A reason this client does not know yet: covered by the generic message.
      return null;
  }
}

/**
 * One localized sentence per blocking reason in `reasons` (all of them by
 * default), in the backend's order. Reasons this client does not know are
 * skipped.
 */
export function describePublishBlockingReasons(
  checks: PublishPublicCropPreview,
  t: TFunction,
  reasons: readonly PublishBlockingReason[] = checks.blocking_reasons ?? [],
): string[] {
  return reasons
    .map((reason) => describeReason(reason, checks, t))
    .filter((message): message is string => Boolean(message));
}

/**
 * The message for a rejected publish. Falls back to the generic publish error
 * when no reason is known, so the user is never left with an empty message.
 */
export function describePublishChecksFailure(checks: PublishPublicCropPreview, t: TFunction): string {
  const messages = describePublishBlockingReasons(checks, t);
  return messages.length > 0 ? messages.join(' ') : t('library.publishError');
}
