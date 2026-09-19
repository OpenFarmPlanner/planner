export interface SeedPackage {
  id?: number;
  crop?: number;
  size_value: number;
  size_unit: 'g' | 'seeds';
  evidence_text?: string;
  last_seen_at?: string | null;
}

export interface Supplier {
  id?: number;
  name: string;
  homepage_url?: string;
  slug?: string;
  allowed_domains: string[];
  created_at?: string;
  updated_at?: string;
  created?: boolean;
}

export interface SupplierDeleteUsage {
  can_delete: boolean;
  crop_count: number;
  seed_demand_crop_count: number;
  supplier_data_crop_count: number;
  supplier_data_count: number;
  total_crop_count: number;
  crop_ids: number[];
}

export interface SupplierDeleteUndoPayload {
  supplier: {
    id: number;
    name: string;
    homepage_url: string;
    slug: string;
    allowed_domains: string[];
  };
  crop_ids: number[];
  seed_demand_crop_ids: number[];
  supplier_data: Array<{
    id: number;
    crop_id: number;
    supplier_name: string;
    supplier_url: string;
    supplier_product_name: string;
    supplier_product_url: string;
    packaging_sizes: SeedPackage[];
    thousand_kernel_weight_g: string | null;
    germination_rate: number | null;
    price: string | null;
    notes: string;
    source_url: string;
  }>;
}

export interface SupplierUnlinkDeleteResponse {
  affected_crop_count: number;
  undo_payload: SupplierDeleteUndoPayload;
}

export interface SupplierDeleteResponse {
  undo_payload: SupplierDeleteUndoPayload;
}

export interface SupplierRestoreUnlinkedDeleteResponse {
  supplier: Supplier;
  restored_crop_count: number;
  restored_supplier_data_count: number;
}

export type SeedRateUnit = 'g_per_m2' | 'g_per_lfm' | 'seeds_per_m2' | 'seeds_per_lfm' | 'seeds_per_plant';
export type CultivationType = 'pre_cultivation' | 'direct_sowing';

export interface SeedRateUnitConstraint {
  value_type: 'number' | 'integer';
  step: number;
  minimum: number;
}

export type SeedRateUnitConstraints = Record<SeedRateUnit, SeedRateUnitConstraint>;

export interface SeedRateConstraintsResponse {
  units: SeedRateUnitConstraints;
}

export interface SeedRateByCultivationEntry {
  value: number;
  unit: SeedRateUnit;
}

export type SeedRateByCultivation = Partial<Record<CultivationType, SeedRateByCultivationEntry>>;

export interface SeedRequirementEntry {
  value: number;
  unit: SeedRateUnit;
  safety_percent?: number;
}

export type SeedRequirements = Partial<Record<CultivationType, SeedRequirementEntry>>;

export interface Crop {
  /** Explicitly seed empty general-crop fields when creating this variety. */
  copy_values_to_crop?: boolean;
  source_public_crop?: number | null;
  source_public_version?: number | null;
  origin_type?: 'manual' | 'imported';
  owned_public_crop_id?: number | null;
  owned_public_crop_role?: PublicCropOwnershipRole | null;
  is_modified_from_source?: boolean;
  /** True when the linked library entry has a newer version the user has not decided on yet. */
  public_update_available?: boolean;
  /** True when the user explicitly declined exactly the library version that is pending. */
  public_update_rejected?: boolean;
  /** Why pushing this copy into the public library is blocked, or null when it is allowed. */
  public_publish_blocked_reason?: PublicPublishBlockedReason | null;
  /** True while this crop's own library entry sits under a crop species no moderator reviewed yet. */
  public_crop_species_pending?: boolean;
  crop_species?: number | null;
  thousand_kernel_weight_g?: number;
  package_size_g?: number; // deprecated, replaced by seed_packages
  seeding_requirement?: number;
  seeding_requirement_type?: 'per_sqm' | 'per_plant' | '';
  seed_packages?: SeedPackage[];
  seed_rate_value?: number | null;
  seed_rate_unit?: SeedRateUnit | null;
  seed_rate_by_cultivation?: SeedRateByCultivation | null;
  seed_requirements?: SeedRequirements;
  seed_rate_direct_value?: number | null;
  seed_rate_direct_unit?: SeedRateUnit | null;
  sowing_calculation_safety_percent_direct?: number | null;
  seed_rate_pre_cultivation_value?: number | null;
  seed_rate_pre_cultivation_unit?: SeedRateUnit | null;
  sowing_calculation_safety_percent_pre_cultivation?: number | null;
  id?: number;
  name: string;
  /** Species name in the request language, after the fallback chain. */
  crop_display_name?: string | null;
  /** Language `crop_display_name` actually came from; '' when no translation exists. */
  crop_display_language_code?: string | null;
  /** Language imported public-library notes actually came from; null when no public description applies. */
  description_language_code?: string | null;
  /** Every stored linked species name, keyed by language code. */
  crop_species_translations?: Record<string, string>;
  variety?: string;
  seed_supplier?: string;
  supplier?: Supplier | null;
  selected_seed_demand_supplier?: number | null;
  supplier_product_url?: string | null;
  supplier_data?: CropSupplierData[];
  supplier_data_input?: CropSupplierDataInput[];
  image_file?: MediaFileRef | null;
  image_file_id?: number | null;
  notes?: string;

  crop_family?: string;
  nutrient_demand?: 'low' | 'medium' | 'high' | '';
  rotation_break_years?: number | null;
  cultivation_type?: CultivationType | '';
  cultivation_types?: CultivationType[];
  
  growth_duration_days?: number;
  harvest_duration_days?: number;
  propagation_duration_days?: number;
  
  harvest_method?: 'per_plant' | 'per_sqm' | '';
  expected_yield?: number;
  
  distance_within_row_cm?: number;
  row_spacing_cm?: number;
  sowing_depth_cm?: number;

  sowing_calculation_safety_percent?: number;
  
  display_color?: string;
  
  // Computed, read-only.
  plants_per_m2?: number | null;

  /**
   * Read-only inheritance data for a Sorte: the general Kultur it falls back to
   * (same project, same crop species, no variety) and the resolved value of
   * every inheritable field. The plain fields above always stay the row's *own*
   * values, so a field is inherited exactly when it appears in
   * `inherited_fields`. All three are absent/empty when there is nothing to
   * inherit from — a general Kultur, or a free-text Sorte without a species.
   */
  general_crop?: number | null;
  inherited_fields?: CropInheritableField[];
  effective_values?: Partial<Crop>;

  created_at?: string;
  updated_at?: string;
}

/**
 * Crop fields a Sorte inherits from its general Kultur. Mirrors
 * `CROP_INHERITABLE_FIELDS` in backend/farm/services/crop_inheritance.py.
 */
export type CropInheritableField =
  | 'crop_family'
  | 'nutrient_demand'
  | 'rotation_break_years'
  | 'cultivation_type'
  | 'cultivation_types'
  | 'growth_duration_days'
  | 'harvest_duration_days'
  | 'propagation_duration_days'
  | 'harvest_method'
  | 'expected_yield'
  | 'distance_within_row_cm'
  | 'row_spacing_cm'
  | 'sowing_depth_cm'
  | 'sowing_calculation_safety_percent'
  | 'sowing_calculation_safety_percent_direct'
  | 'sowing_calculation_safety_percent_pre_cultivation'
  | 'thousand_kernel_weight_g'
  | 'seeding_requirement'
  | 'seeding_requirement_type'
  | 'seed_rate_direct_value'
  | 'seed_rate_direct_unit'
  | 'seed_rate_pre_cultivation_value'
  | 'seed_rate_pre_cultivation_unit';

export interface CropSupplierData {
  id?: number;
  crop?: number;
  project?: number;
  supplier?: Supplier | null;
  supplier_id?: number | null;
  supplier_name?: string;
  supplier_name_input?: string;
  supplier_url?: string;
  supplier_product_name?: string;
  supplier_product_url?: string;
  packaging_sizes?: SeedPackage[];
  germination_rate?: number | null;
  price?: number | null;
  notes?: string;
  source_url?: string;
}

export interface CropSupplierDataInput {
  id?: number;
  supplier_id?: number | null;
  supplier_name_input?: string;
  supplier_name?: string;
  supplier_url?: string;
  supplier_product_name?: string;
  supplier_product_url?: string;
  packaging_sizes?: SeedPackage[];
  germination_rate?: number | null;
  price?: number | null;
  notes?: string;
  source_url?: string;
}




export interface PublicCrop {
  id: number;
  status: 'draft' | 'published' | 'withdrawn' | 'removed';
  removal_reason?: PublicCropRemovalReason | '';
  name: string;
  variety?: string;
  notes?: string;
  crop_species?: number | null;
  /** Species common name already resolved into the request language. */
  crop_species_name?: string;
  /** Canonical, language-independent species label (editorial use). */
  crop_species_canonical_name?: string;
  /** Every stored species name, keyed by language code. */
  crop_species_translations?: Record<string, string>;
  /** Canonical name, translations, synonyms, and regional names used for Kulturart matching. */
  crop_species_search_names?: string[];
  /** Moderation state of the linked species; 'proposed' means still awaiting review. */
  crop_species_status?: CropSpecies['status'] | '';
  /** Species name in the request language, after the fallback chain. */
  display_name?: string;
  /** Language `display_name` actually came from; '' when no translation exists. */
  display_language_code?: string;
  /** Public description in the request language, after the fallback chain. */
  description?: string;
  /** Language `description` actually came from; null when none exists. */
  description_language_code?: string | null;
  /** Every stored public description, keyed by language code. */
  translations?: Record<string, string>;
  original_language_code?: string;
  crop_family?: string;
  nutrient_demand?: 'low' | 'medium' | 'high' | '';
  cultivation_type?: CultivationType | '';
  cultivation_types?: CultivationType[];
  growth_duration_days?: number | null;
  harvest_duration_days?: number | null;
  propagation_duration_days?: number | null;
  harvest_method?: 'per_plant' | 'per_sqm' | '';
  expected_yield?: number | null;
  distance_within_row_m?: number | null;
  distance_within_row_cm?: number | null;
  row_spacing_m?: number | null;
  row_spacing_cm?: number | null;
  sowing_depth_m?: number | null;
  sowing_depth_cm?: number | null;
  seed_rate_value?: number | null;
  seed_rate_unit?: SeedRateUnit | null;
  seed_rate_by_cultivation?: SeedRateByCultivation | null;
  seed_requirements?: SeedRequirements;
  seed_rate_direct_value?: number | null;
  seed_rate_direct_unit?: SeedRateUnit | null;
  seed_rate_pre_cultivation_value?: number | null;
  seed_rate_pre_cultivation_unit?: SeedRateUnit | null;
  thousand_kernel_weight_g?: number | null;
  seeding_requirement?: number | null;
  seeding_requirement_type?: 'per_sqm' | 'per_plant' | '';
  display_color?: string;
  seed_packages?: SeedPackage[];
  version: number;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  created_by_label?: string;
  source_project_crop?: number | null;
  source_project?: number | null;
  /** Set when the active project already imported this entry; null otherwise. */
  project_import_status?: PublicCropProjectImportStatus | null;
  /** Number of project crops (across all projects) currently linked to this entry. */
  imported_crops_count?: number;
}

export interface PublicCropUpdateFieldChange {
  field: string;
  local_value: unknown;
  public_value: unknown;
}

/**
 * Preview of the pending library update for one imported project crop.
 * `available: false` means the copy is already on the library's current
 * version (or is not linked to a published entry at all).
 */
export interface CropPublicUpdate {
  available: boolean;
  public_crop_id?: number;
  public_crop_name?: string;
  public_version?: number;
  local_version?: number | null;
  has_local_changes?: boolean;
  /** True when this exact public version was already declined by the user. */
  is_rejected?: boolean;
  changes?: PublicCropUpdateFieldChange[];
}

export interface PublicCropProjectImportStatus {
  crop_id: number;
  crop_name: string;
  is_modified_from_source: boolean;
  /**
   * True when re-importing this entry would change nothing in the project —
   * the copy is pristine and already carries the library's current values.
   * The update action is disabled on it, so the no-op never has to be
   * explained after the fact.
   */
  is_up_to_date: boolean;
}

export interface PublicCropTranslations {
  original_language_code: string;
  translations: Record<string, string>;
  crop_species_translations?: Record<string, string>;
}

export type PublicCropChangeProposalStatus = 'pending' | 'approved' | 'rejected';

export interface PublicCropChangeProposal {
  id: number;
  public_crop: number;
  summary: string;
  proposed_data: Partial<PublicCrop>;
  status: PublicCropChangeProposalStatus;
  proposed_by_label?: string;
  reviewed_by_label?: string;
  review_note?: string;
  reviewed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PublicCropRevisionChange {
  field: string;
  old_value: unknown;
  new_value: unknown;
}

export interface PublicCropRevision {
  id: number;
  public_crop: number;
  version: number;
  action: 'created' | 'updated' | 'restored' | 'species_relinked';
  snapshot: Partial<PublicCrop>;
  changed_fields: PublicCropRevisionChange[];
  restored_from_version?: number | null;
  created_by_label?: string;
  created_at?: string;
}

export interface PublicCropSpeciesRelinkRequest {
  id: number;
  public_crop: number;
  from_crop_species: number | null;
  to_crop_species: number;
  status: 'pending' | 'completed' | 'cancelled';
  note: string;
  resolution_note: string;
  requested_by_label?: string;
  created_at?: string;
  resolved_at?: string | null;
}

export interface PublicCropSpeciesRelinkResponse {
  /**
   * `relinked` when the correction was applied. `pending_species_proposal`
   * when the target species is still awaiting moderation — the entry keeps its
   * current species and the relink runs on approval.
   */
  relink_status: 'relinked' | 'pending_species_proposal';
  crop: PublicCrop;
  relink_request: PublicCropSpeciesRelinkRequest | null;
}

export interface PublicCropDiscussionComment {
  id: number;
  topic: number;
  parent?: number | null;
  body: string;
  created_by_label?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  deletion_kind?: 'author' | 'moderator' | 'unknown' | null;
  delete_blocked_reason?: 'visible_replies' | null;
  is_edited: boolean;
  can_edit: boolean;
  can_delete?: boolean;
}

export interface PublicCropDiscussionTopic {
  id: number;
  public_crop: number;
  title: string;
  created_by_label?: string;
  created_at?: string;
  revision?: number | null;
  version?: number | null;
  comment_count: number;
  last_activity_at?: string | null;
  last_comment_preview?: string | null;
}

/**
 * How the current user relates to the public-library entry linked to a project
 * crop. Contributors remove their own entry without a reason, moderators
 * remove somebody else's entry and must pick a moderation reason.
 */
export type PublicCropOwnershipRole = 'contributor' | 'moderator';

/**
 * Why a linked project crop may not be pushed into the public library:
 * an undecided library update, a version the user declined, or a copy that is
 * aligned with the library and carries no local edits worth contributing.
 */
export type PublicPublishBlockedReason = 'update_pending' | 'update_rejected' | 'no_local_changes';

export type PublicCropRemovalReason =
  | 'accidental_publication'
  | 'test_data'
  | 'duplicate'
  | 'wrong_mapping'
  | 'unlawful_content'
  // System-applied only, set when the crop species behind an entry is
  // rejected — never offered as a choice in the manual removal dialog.
  | 'species_rejected'
  | 'other';

export interface PublicCropDuplicateCandidate {
  id: number;
  name: string;
  variety?: string;
  version: number;
  published_at?: string | null;
  created_by_label?: string;
  is_mine: boolean;
}

export interface GeneralCropNotice {
  public_crop_id: number;
  updated_at: string;
  is_stale: boolean;
  is_incomplete: boolean;
}

export interface CropDuplicateCheckResponse {
  exists: boolean;
  name_exists?: boolean;
}

export interface CropDeletePreview {
  crop_ids: number[];
  varieties: Array<{ id: number; name: string }>;
  variety_count: number;
  planning_data_count: number;
  deletes_general_crop: boolean;
  group_without_general: boolean;
}

export interface PublicCropMatchResponse {
  exists: boolean;
  crop: Pick<PublicCrop, 'id' | 'name' | 'variety'> | null;
}

export interface PublishPublicCropDuplicateError {
  code: 'duplicate_public_crop';
  detail: string;
  duplicates: PublicCropDuplicateCandidate[];
  normalized_identity?: {
    name: string;
    variety: string;
  };
}

export type ImportPublicCropOperation = 'created' | 'unchanged' | 'updated';

export interface ImportPublicCropResponse {
  crop: Crop;
  operation: ImportPublicCropOperation;
}

export interface ImportPublicCropConfirmationRequiredError {
  code: 'import_requires_confirmation';
  detail: string;
  existing_crop_id: number;
  existing_crop_name: string;
  /** Whether the library entry's variety name differs from the local copy's current variety. */
  variety_changed?: boolean;
  existing_variety?: string;
  public_variety?: string;
}

export interface CropSpeciesTranslation {
  language_code: string;
  common_name: string;
  synonyms?: string[];
  regional_names?: Record<string, string>;
}

export interface CropSpecies {
  id: number;
  name: string;
  scientific_name?: string;
  family?: string;
  categories?: string[];
  display_name?: string;
  display_language_code?: string;
  translations?: CropSpeciesTranslation[];
  /** Canonical name, translations, synonyms, and regional names used for Kulturart matching. */
  search_names?: string[];
  status: 'published' | 'proposed' | 'rejected';
  proposed_by_label?: string;
  reviewed_by_label?: string;
  review_note?: string;
  reviewed_at?: string | null;
  similar_species?: Array<{
    id: number;
    name: string;
    match_type: 'exact' | 'similar';
  }>;
}

export type PublicLibraryModeratorRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PublicLibraryModeratorRequest {
  id: number;
  user: number;
  user_label: string;
  motivation: string;
  status: PublicLibraryModeratorRequestStatus;
  reviewed_by_label?: string;
  review_note?: string;
  reviewed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PublicLibraryModeratorRequestMine {
  is_moderator: boolean;
  request: PublicLibraryModeratorRequest | null;
}

export interface PublishPublicCropPreview {
  crop_species: Pick<CropSpecies, 'id' | 'name'> | null;
  original_language_code: string;
  available_language_codes: string[];
  missing_required_fields: Array<{ field: string; label_key: string }>;
  duplicates: PublicCropDuplicateCandidate[];
  can_publish: boolean;
  general_crop_notice: GeneralCropNotice | null;
}

export interface PublishPublicCropResponse {
  operation: 'created' | 'updated';
  public_crop: PublicCrop;
  duplicates: PublicCropDuplicateCandidate[];
}

export interface SeedDemand {
  crop_id: number;
  crop_name: string;
  crop_display_name?: string | null;
  crop_display_language_code?: string | null;
  variety?: string | null;
  supplier?: string | null;
  selected_supplier_id?: number | null;
  supplier_options?: Array<{ supplier_id: number; supplier_name: string }>;
  total_grams: number | null;
  required_amount_value: number | null;
  required_amount_unit: 'g' | 'seeds' | null;
  required_amount_warning?: 'missing_tkg' | string | null;
  calculation_blockers?: Array<
    | 'missing_seed_rate'
    | 'missing_area'
    | 'missing_row_spacing'
    | 'missing_plant_quantity'
    | 'missing_tkg'
    | 'unsupported_seed_rate_unit'
    | string
  >;
  seed_packages?: Array<{ size_value: number; size_unit: 'g' | 'seeds' }>;
  package_suggestion?: {
    selection: Array<{ size_value: number; size_unit: 'g' | 'seeds'; count: number }>;
    total_amount: number;
    overage: number;
    pack_count: number;
    unit?: 'g' | 'seeds';
  } | null;
  package_blocker?:
    | 'required_amount_unavailable'
    | 'supplier_data_missing'
    | 'supplier_not_selected'
    | 'package_sizes_missing'
    | 'unit_conversion_unavailable'
    | 'no_matching_package_sizes'
    | string
    | null;
  warning: string | null;
}

export interface Location {
  id?: number;
  name: string;
  address?: string;
  description?: string;
  soil_type?: 'sand' | 'loam' | 'clay' | null;
  exposure?: 'north' | 'south' | 'east' | 'west' | 'flat' | null;
  latitude?: number;
  longitude?: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Field {
  id?: number;
  name: string;
  location: number;
  location_name?: string;
  area_sqm?: number;
  length_m?: number | null;
  width_m?: number | null;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Bed {
  id?: number;
  name: string;
  field: number;
  field_name?: string;
  area_sqm?: number;
  length_m?: number | null;
  width_m?: number | null;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}



export interface BedLayoutEntry {
  id?: number;
  bed: number;
  location: number;
  field_id?: number;
  x: number;
  y: number;
  version?: number;
  scale?: number | null;
  created_at?: string;
  updated_at?: string;
}


export interface FieldLayoutEntry {
  id?: number;
  field: number;
  location: number;
  x: number;
  y: number;
  version?: number;
  scale?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface LocationLayoutsResponse {
  bed_layouts: BedLayoutEntry[];
  field_layouts: FieldLayoutEntry[];
}
export interface PlantingPlan {
  id?: number;
  // Optional until the plan is fully filled in — a plan can be saved as a
  // draft as long as at least one of crop/bed is chosen.
  crop: number | null;
  cultivation_type?: CultivationType | '';
  crop_name?: string | null;
  crop_display_name?: string | null;
  crop_display_language_code?: string | null;
  crop_variety?: string | null;
  crop_display_color?: string | null;
  crop_propagation_duration_days?: number | null;
  crop_cultivation_type?: CultivationType | '' | null;
  crop_cultivation_types?: CultivationType[] | null;
  bed: number | null;
  bed_name?: string | null;
  season?: number | null;
  planting_date: string | null;
  // Read-only, computed.
  harvest_date?: string | null;
  // Read-only, computed.
  harvest_end_date?: string | null;
  quantity?: number;
  plants_count?: number | null;
  area_usage_sqm?: number;
  // Write-only input used on create/update.
  area_input_value?: number;
  // Write-only input used on create/update.
  area_input_unit?: 'M2' | 'PLANTS';
  notes?: string;
  note_attachment_count?: number;
  created_at?: string;
  updated_at?: string;
}



export interface Season {
  id: number;
  project: number;
  start_date: string;
  end_date: string;
  custom_label: string;
  label: string;
  computed_label: string;
  planting_plan_count: number;
  created_at: string;
  updated_at: string;
}

export interface SeasonPattern {
  id: number;
  project: number;
  start_day: number;
  start_month: number;
  created_at: string;
  updated_at: string;
}

export interface SeasonPatternPreviewPeriod {
  start_date: string;
  end_date: string;
  is_current: boolean;
}

export interface SeasonPeriodRange {
  start_date: string;
  end_date: string;
}

/** A gap or overlap between the end of one season period and the start of the next. */
export interface SeasonPeriodTransition {
  kind: 'gap' | 'overlap';
  start_date: string;
  end_date: string;
}

export interface SeasonPatternPreviewResponse {
  periods: SeasonPatternPreviewPeriod[];
  reference_season: { start_date: string; end_date: string; label: string } | null;
  transition: SeasonPeriodTransition | null;
}

/** How many of a source season's planting plans would land inside a target period. */
export interface SeasonCopyCounts {
  total: number;
  copied: number;
  skipped: number;
}

export interface SeasonCreationOptions {
  start_day: number;
  start_month: number;
  last_season: { start_date: string; end_date: string; label: string } | null;
  due_period: SeasonPeriodRange | null;
  transition: SeasonPeriodTransition | null;
  seamless_period: SeasonPeriodRange | null;
  manual_period: SeasonPeriodRange | null;
  manual_residual: SeasonPeriodTransition | null;
  copy_source_label: string | null;
  copy_preview: {
    adopt: SeasonCopyCounts | null;
    transition: SeasonCopyCounts | null;
    transition_followup: SeasonCopyCounts | null;
    manual: SeasonCopyCounts | null;
  };
}

export interface SeasonPeriodEditPlantingConflict {
  id: number | string;
  label: string;
  crop: string;
  planting_date: string;
}

export interface SeasonPeriodEditOverlapConflict {
  season_id: number;
  season_label: string;
  overlap_start_date: string;
  overlap_end_date: string;
}

export interface SeasonPeriodEditConflict {
  code: 'season_period_edit_conflict';
  detail?: string;
  planting_plan_conflicts: SeasonPeriodEditPlantingConflict[];
  overlap_conflicts: SeasonPeriodEditOverlapConflict[];
}

export interface SeasonCreateTransitionResponse {
  transition_season: Season;
  followup_season: Season;
  transition_copied_count: number;
  followup_copied_count: number;
  skipped_count: number;
}

export interface SeasonDueSuggestion {
  due: boolean;
  start_date?: string;
  end_date?: string;
}

export interface SeasonCopyFromResponse {
  copied_count: number;
  skipped_count: number;
  target_planting_plan_count: number;
}

export interface SeasonSetupStatus {
  needs_setup: boolean;
  unassigned_planting_plan_count: number;
  start_day: number;
  start_month: number;
  computed_start_date: string;
  computed_end_date: string;
}

export interface SeasonSetupApplyResponse {
  season: Season;
  assigned_planting_plan_count: number;
  start_day: number;
  start_month: number;
}

export interface RemainingAreaResponse {
  bed_id: number;
  bed_area_sqm: number;
  overlapping_used_area_sqm: number;
  remaining_area_sqm: number;
  start_date: string;
  end_date: string;
}

export interface YieldCalendarCrop {
  crop_id: number;
  crop_name: string;
  crop_display_name?: string | null;
  crop_display_language_code?: string | null;
  color: string;
  yield: number;
}

export interface YieldCalendarWeek {
  iso_week: string;
  week_start: string;
  week_end: string;
  crops: YieldCalendarCrop[];
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}


export interface NoteAttachment {
  id: number;
  planting_plan: number;
  image: string;
  image_url?: string;
  caption?: string;
  created_at: string;
  width?: number;
  height?: number;
  size_bytes?: number;
  mime_type?: string;
}


export interface MediaFileRef {
  id: number;
  storage_path: string;
  uploaded_at?: string;
}

export interface CropHistoryEntry {
  history_id: number;
  crop_id?: number;
  history_date: string;
  history_type: string;
  history_user: string | null;
  summary: string;
  object_type?: string;
  object_display_name?: string | null;
  action?: string;
  actor_label?: string | null;
  is_current_version?: boolean;
  changes?: CropHistoryChange[];
  /** Project history only: this entry groups a cascading action's revisions. */
  is_batch?: boolean;
  batch_id?: number;
  batch_operation_type?: string;
  batch_context?: Record<string, unknown>;
  children?: CropHistoryEntry[];
}

export interface CropHistoryChange {
  field: string;
  old_value: unknown;
  new_value: unknown;
}

/**
 * Scope of a project-bound API token.
 *
 * `read` permits safe requests only; `write` additionally permits creating and
 * updating project data; `delete` also permits crop soft-delete and restore.
 * No scope can reach administrative endpoints — see docs/agent-api.md.
 */
export type ApiTokenScope = 'read' | 'write' | 'delete';

/** Lifecycle status derived server-side from expiry and revocation. */
export type ApiTokenStatus = 'active' | 'expired' | 'revoked';

/**
 * A project-bound API token as listed in the account settings.
 *
 * Deliberately without the secret: the plaintext value exists only in the
 * creation response (`ApiTokenCreated`) and is never returned again.
 */
export interface ApiToken {
  id: number;
  name: string;
  project: number;
  project_name: string;
  scope: ApiTokenScope;
  token_prefix: string;
  status: ApiTokenStatus;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Creation response — the only place the plaintext token is ever available. */
export interface ApiTokenCreated extends ApiToken {
  token: string;
}

export interface ApiTokenCreatePayload {
  name: string;
  project: number;
  scope: ApiTokenScope;
  expires_at?: string | null;
}

/**
 * One in-app notification. The backend keeps `message` in English for
 * admin/API consumers; the UI renders `notification_type` + `context` through
 * i18n instead, so the same row reads in whatever language the user picked.
 */
export type NotificationType =
  | 'crop_species_proposal_accepted'
  | 'crop_species_proposal_rejected'
  | 'crop_species_proposal_submitted'
  | 'moderator_request_submitted'
  | 'public_crop_removed';

export type NotificationTargetType = 'public_crop' | 'crop_species' | 'public_library_moderation' | '';

export interface AppNotification {
  id: number;
  notification_type: NotificationType;
  /** English fallback text — never rendered by the app UI. */
  message: string;
  context: Record<string, string>;
  target_type: NotificationTargetType;
  target_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResponse extends PaginatedResponse<AppNotification> {
  unread_count: number;
}
