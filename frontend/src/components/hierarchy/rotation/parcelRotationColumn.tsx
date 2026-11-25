import type { GridColDef } from '@mui/x-data-grid';
import type { TFunction } from 'i18next';
import { Box, CircularProgress } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import type { HierarchyRow } from '../utils/types';
import { AppTooltip } from '../../AppTooltip';
import { TruncatedTextWithTooltip } from '../../TruncatedTextWithTooltip';
import { widthForHeaderTitles } from '../../data-grid/columnHeaderWidth';
import {
  formatParcelRotationMembership,
  type ParcelRotationLoadStatus,
  type ParcelRotationMembership,
} from './parcelRotationContext';

export const PARCEL_ROTATION_COLUMN_FIELD = 'rotation_group';

/**
 * Optional read-only column with a parcel's rotation group and position (#1576).
 * Other rows stay blank; parcel cells show the load state until the groups are known,
 * so a parcel is never presented as unassigned while loading or after a failed load.
 */
export function createParcelRotationColumn(
  t: TFunction,
  memberships: ReadonlyMap<number, ParcelRotationMembership>,
  status: ParcelRotationLoadStatus = 'ready',
): GridColDef<HierarchyRow> {
  const headerName = t('hierarchy:parcelRotation.group');
  return {
    field: PARCEL_ROTATION_COLUMN_FIELD,
    headerName,
    width: widthForHeaderTitles([headerName], { baseWidth: 140, allowance: 30, maxWidth: 220 }),
    editable: false,
    sortable: false,
    valueGetter: (_value, row: HierarchyRow) => {
      const membership = status === 'ready' && row.type === 'field' && row.fieldId
        ? memberships.get(row.fieldId) : undefined;
      return membership ? formatParcelRotationMembership(membership) : '';
    },
    renderCell: (params) => {
      if (params.row.type === 'field' && status === 'loading') {
        return <CircularProgress size={14} aria-label={t('common:messages.loading')} />;
      }
      if (params.row.type === 'field' && status === 'error') {
        const message = t('hierarchy:parcelRotation.loadError');
        return (
          <AppTooltip title={message}>
            <Box component="span" role="img" aria-label={message} tabIndex={0}
              sx={{ display: 'inline-flex', color: 'error.main' }} data-testid="parcel-rotation-load-error">
              <ErrorOutlineIcon fontSize="small" />
            </Box>
          </AppTooltip>
        );
      }
      return params.value
        ? <TruncatedTextWithTooltip text={String(params.value)} data-testid="parcel-rotation-cell" />
        : null;
    },
  };
}
