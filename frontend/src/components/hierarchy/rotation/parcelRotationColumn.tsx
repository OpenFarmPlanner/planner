import type { GridColDef } from '@mui/x-data-grid';
import type { TFunction } from 'i18next';
import type { HierarchyRow } from '../utils/types';
import { TruncatedTextWithTooltip } from '../../TruncatedTextWithTooltip';
import { widthForHeaderTitles } from '../../data-grid/columnHeaderWidth';
import { formatParcelRotationMembership, type ParcelRotationMembership } from './parcelRotationContext';

export const PARCEL_ROTATION_COLUMN_FIELD = 'rotation_group';

/** Optional read-only column with a parcel's rotation group and position; blank for other rows (#1576). */
export function createParcelRotationColumn(
  t: TFunction,
  memberships: ReadonlyMap<number, ParcelRotationMembership>,
): GridColDef<HierarchyRow> {
  const headerName = t('hierarchy:parcelRotation.group');
  return {
    field: PARCEL_ROTATION_COLUMN_FIELD,
    headerName,
    width: widthForHeaderTitles([headerName], { baseWidth: 140, allowance: 30, maxWidth: 220 }),
    editable: false,
    sortable: false,
    valueGetter: (_value, row: HierarchyRow) => {
      const membership = row.type === 'field' && row.fieldId ? memberships.get(row.fieldId) : undefined;
      return membership ? formatParcelRotationMembership(membership) : '';
    },
    renderCell: (params) => (
      params.value ? (
        <TruncatedTextWithTooltip text={String(params.value)} data-testid="parcel-rotation-cell" />
      ) : null
    ),
  };
}
