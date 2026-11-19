import type { Crop, PublicCrop, StagedPlantHealthMapping } from '../api/types';
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
  healthMappings?: StagedPlantHealthMapping[];
  cropUpdatedAt?: string;
  cropId: number;
  /** Set when the Sorte matches an existing public entry and is only linked to it. */
  publicCropId: number | null;
  baseVersion?: number;
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
