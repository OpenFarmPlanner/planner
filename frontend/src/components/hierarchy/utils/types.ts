/**
 * Type definitions for hierarchical data grid
 */
import type {
  EffectiveSiteConditions,
  IrrigationAvailability,
  LightCondition,
  SoilMoisture,
} from '../../../api/types';

/**
 * Combined row type for hierarchy
 */
export interface HierarchyRow {
  id: string | number;
  [key: string]: unknown;
  type: 'location' | 'field' | 'bed' | 'individualPlan';
  level: number;
  expanded?: boolean;
  hasChildren?: boolean;
  parentId?: string | number;
  // Bed fields
  name?: string;
  field?: number;
  field_name?: string;
  area_sqm?: number | string;
  length_m?: number | null;
  width_m?: number | null;
  notes?: string;
  // The row's own (explicit) site conditions; null/undefined inherits.
  light_condition?: LightCondition | null;
  soil_moisture?: SoilMoisture | null;
  irrigation?: IrrigationAvailability | null;
  /** Resolved location → field → bed values, see `utils/siteConditions.ts`. */
  effectiveSiteConditions?: EffectiveSiteConditions;
  /** What the parents provide, i.e. the value after "Reset to inherited". */
  inheritedSiteConditions?: EffectiveSiteConditions;
  // Location/Field metadata
  locationId?: number;
  fieldId?: number;
  bedId?: number;
  plantingPlanId?: number;
  individualPlantCount?: number;
  isNew?: boolean;
}
