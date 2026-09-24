import axios from 'axios';
import { cropAPI } from '../api/api';
import type { Crop, PublicCrop } from '../api/types';
import { getCropDisplayName, getCropVariety } from './cropDisplay';
import { normalizeCropIdentityValue } from './cropIdentity';

/**
 * A project Sorte the publishing wizard offers to publish together with its
 * general Kultur.
 *
 * Sorten that are already connected to the library are not candidates: they
 * either have their own public entry already, or they were imported from one.
 * Re-linking them here would flip `origin_type` to `imported` on a row the
 * user owns (see `link_project_crop_to_public_reference`).
 */
export interface PublishVarietyCandidate {
  crop: Crop;
  cropId: number;
  label: string;
  /** Public entry with the same/similar variety name: link instead of proposing a duplicate. */
  existingPublicCrop: PublicCrop | null;
}

export interface PublishVarietySelection {
  cropId: number;
  /** Set when the Sorte matches an existing public entry and is only linked to it. */
  publicCropId: number | null;
}

export interface PublishVarietiesResult {
  published: number;
  linked: number;
  /** Rejected by the backend's duplicate gate — the Sorte is public already. */
  alreadyPublic: number;
  /** Queued for moderator review instead of published (see docs/account-trust-levels.md). */
  pendingModeration: number;
  failed: number;
}

export const getPublishVarietyLabel = (crop: Crop): string => (
  getCropVariety(crop).trim() || getCropDisplayName(crop)
);

const isConnectedToLibrary = (crop: Crop): boolean => (
  Boolean(crop.owned_public_crop_id) || Boolean(crop.source_public_crop)
);

/**
 * The public entry this Sorte would duplicate, if any.
 *
 * Deliberately the strict identity rule (`normalizeCropIdentityValue`: casing
 * and whitespace only, the same normalization the duplicate check uses), not
 * the species picker's fuzzy matcher. Linking is destructive in a way the
 * species picker's suggestion is not — it points the user's own Sorte at a
 * stranger's entry and flips `origin_type` to `imported` for good — so a
 * near-miss like "Matina"/"Marina" must stay two Sorten. Missing a match only
 * means the backend's own duplicate gate reports it afterwards.
 */
export const findExistingPublicVariety = (
  crop: Crop,
  publicCrops: readonly PublicCrop[],
): PublicCrop | null => {
  const varietyName = normalizeCropIdentityValue(getCropVariety(crop));
  if (!varietyName) {
    return null;
  }
  return publicCrops.find((candidate) => (
    normalizeCropIdentityValue(candidate.variety) === varietyName
  )) ?? null;
};

/** The Sorten of a Kultur group that can still be published from the wizard. */
export const getPublishableVarieties = (varieties: readonly Crop[]): Crop[] => (
  varieties.filter((crop) => (
    typeof crop.id === 'number'
    && Boolean(getCropVariety(crop).trim())
    && !isConnectedToLibrary(crop)
  ))
);

export const buildPublishVarietyCandidates = (
  varieties: readonly Crop[],
  publicCrops: readonly PublicCrop[],
): PublishVarietyCandidate[] => (
  getPublishableVarieties(varieties)
    .map((crop) => ({
      crop,
      cropId: crop.id as number,
      label: getPublishVarietyLabel(crop),
      existingPublicCrop: findExistingPublicVariety(crop, publicCrops),
    }))
);

/**
 * Publish (or link) the Sorten the user kept selected in the publishing wizard.
 *
 * Runs after the general Kultur itself was published, one Sorte at a time: the
 * backend derives the species-level entry from the first publication, and a
 * failing Sorte must not abort the remaining ones.
 */
export const publishSelectedVarieties = async ({
  varieties,
  cropSpeciesId,
  originalLanguageCode,
  acceptedPublicLibraryTerms = false,
}: {
  varieties: readonly PublishVarietySelection[];
  cropSpeciesId?: number;
  originalLanguageCode: string;
  acceptedPublicLibraryTerms?: boolean;
}): Promise<PublishVarietiesResult> => {
  const result: PublishVarietiesResult = { published: 0, linked: 0, alreadyPublic: 0, pendingModeration: 0, failed: 0 };
  for (const variety of varieties) {
    try {
      if (variety.publicCropId) {
        await cropAPI.linkPublicCrop(variety.cropId, variety.publicCropId);
        result.linked += 1;
        continue;
      }
      const response = await cropAPI.publishPublic(variety.cropId, {
        // The backend only records an acceptance while none exists, so
        // repeating the flag from the Kultur publish costs nothing. The wizard
        // collects it on every path that publishes a Sorte, including the one
        // that only links the Kultur to an existing public entry.
        accepted_public_library_terms: acceptedPublicLibraryTerms,
        crop_species_id: cropSpeciesId,
        original_language_code: originalLanguageCode,
      });
      // A queued contribution is not in the library yet, so counting it as
      // published would report a co-publish that did not happen.
      if (response.data.operation === 'pending_moderation') {
        result.pendingModeration += 1;
      } else {
        result.published += 1;
      }
    } catch (error) {
      // A duplicate is not a failure the user has to act on: the Sorte the
      // conflict check did not see (a stale or failed lookup) is in the
      // library already, which is what co-publishing wanted.
      if (axios.isAxiosError(error) && error.response?.status === 409
        && (error.response.data as { code?: string } | undefined)?.code === 'duplicate_public_crop') {
        result.alreadyPublic += 1;
        continue;
      }
      console.error('Error publishing variety:', error);
      result.failed += 1;
    }
  }
  return result;
};
