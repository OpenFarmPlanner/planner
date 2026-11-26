import { createElement } from 'react';
import GrassOutlinedIcon from '@mui/icons-material/GrassOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { TFunction } from 'i18next';
import type { PlacementParent } from '../pages/individualPlantGeometry';
import type { HierarchyRow } from '../components/hierarchy/utils/types';
import { individualPlantGraphicPath } from './individualPlantRoutes';
import { plantingPlanDetailPath } from './plantingPlanDetailRoutes';

export interface IndividualCreationTarget {
  parent: PlacementParent;
  locationId: number;
}

export const IndividualPlantIcon = GrassOutlinedIcon;

export function individualPlantCreationAction(t: TFunction, onClick: () => void) {
  return {
    id: 'add-individual-plants',
    group: 'create' as const,
    label: t('fields:individualPlants.addPlants'),
    icon: createElement(IndividualPlantIcon, { fontSize: 'small' }),
    onClick,
  };
}

export function individualPlantCreationForRow(
  row: HierarchyRow, t: TFunction, onCreate?: (target: IndividualCreationTarget) => void,
) {
  if (!onCreate || !row.locationId || row.isNew || (row.type !== 'field' && row.type !== 'bed')) return null;
  const id = row.type === 'bed' ? row.bedId : row.fieldId;
  if (!id || id <= 0) return null;
  const target: IndividualCreationTarget = { locationId: row.locationId, parent: { kind: row.type, id } };
  return individualPlantCreationAction(t, () => onCreate(target));
}

export function individualPlanRowActions(row: HierarchyRow, t: TFunction, navigate: (path: string) => void, canEdit: boolean) {
  if (!row.plantingPlanId || !row.locationId) return [];
  const { plantingPlanId, locationId } = row;
  const actions = [{
    id: 'individual-plan-details', group: 'details' as const, label: t('fields:individualPlants.details'),
    icon: createElement(InfoOutlinedIcon, { fontSize: 'small' }), onClick: () => navigate(plantingPlanDetailPath(plantingPlanId)),
  }];
  if (canEdit) actions.push({
    id: 'edit-individual-plants', group: 'details', label: t('fields:individualPlants.editPlants'),
    icon: createElement(IndividualPlantIcon, { fontSize: 'small' }), onClick: () => navigate(individualPlantGraphicPath(plantingPlanId, locationId, true)),
  });
  return actions;
}
