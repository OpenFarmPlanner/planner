import type { ReactNode } from 'react';
import { Box, Button, Checkbox, Stack, Typography } from '@mui/material';
import type { Crop } from '../api/types';
import { useTranslation } from '../i18n';
import { formatCropDisplayName } from './cropDisplay';
import type { ProjectCropSelection } from './useProjectCropSelection';

export function CropBulkSelectionActions({ selection, visibleIds, onOpenPreview }: {
  selection: ProjectCropSelection;
  visibleIds: number[];
  onOpenPreview?: () => void;
}) {
  const { t } = useTranslation('crops');
  if (!selection.selected) return null;
  const selectableIds = selection.eligibleVisibleIds(visibleIds);
  const allVisible = selectableIds.length > 0 && selectableIds.every(id => selection.selected?.has(id));
  return (
    <Stack id={selection.controlsId} direction="row" useFlexGap sx={{
      alignItems: 'center', flexWrap: 'wrap', columnGap: 0.5, px: 1, py: 0.5, flexShrink: 0,
    }}>
      <Typography variant="body2" role="status">
        {t('library.batchImport.selected', { count: selection.selected.size })}
      </Typography>
      <Button size="small" disabled={selectableIds.length === 0}
        onClick={() => selection.setSelected(selectableIds, !allVisible)}>
        {t(allVisible ? 'library.batchImport.clearVisible' : 'library.batchImport.selectVisible', { count: selectableIds.length })}
      </Button>
      <Button size="small" onClick={selection.cancel}>{t('library.batchImport.cancelSelection')}</Button>
      <Button size="small" color="error" variant="contained" disabled={!selection.selected.size}
        onClick={() => {
          onOpenPreview?.();
          selection.openSelected();
        }}>
        {t('common:actions.delete')}
      </Button>
    </Stack>
  );
}

export function CropBulkSelectionRow({ selection, crop, children }: {
  selection?: ProjectCropSelection;
  crop?: Crop | null;
  children: ReactNode;
}) {
  const { t } = useTranslation('crops');
  if (!selection?.selected) return children;
  const id = crop?.id;
  const mixed = id !== undefined && selection.isMixed(id);
  return (
    <Box component="li" sx={{
      display: 'flex', alignItems: 'center', minWidth: 0,
      '& > :last-child': { flex: 1, minWidth: 0 },
    }}>
      {crop && id !== undefined ? (
        <Checkbox
          size="small"
          checked={selection.selected.has(id)}
          indeterminate={mixed}
          slotProps={{ input: {
            'aria-label': t('library.batchImport.selectNamed', { name: formatCropDisplayName(crop) }),
            'aria-checked': mixed ? 'mixed' : undefined,
          } }}
          sx={{ width: 44, height: 44, flexShrink: 0 }}
          onChange={(_, checked) => selection.setCropSelected(id, checked)}
        />
      ) : <Box sx={{ width: 44, flexShrink: 0 }} />}
      {children}
    </Box>
  );
}
