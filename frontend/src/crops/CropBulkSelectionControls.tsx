import type { ReactNode } from 'react';
import { Box, Button, Checkbox, Stack, Typography } from '@mui/material';
import type { Crop } from '../api/types';
import { useTranslation } from '../i18n';
import { getCropDisplayName } from './cropDisplay';
import type { ProjectCropSelection } from './useProjectCropSelection';

export function CropBulkSelectionActions({ selection, visibleIds, onOpenPreview }: {
  selection: ProjectCropSelection;
  visibleIds: number[];
  onOpenPreview?: () => void;
}) {
  const { t } = useTranslation('crops');
  if (!selection.selected) return null;
  const allVisible = visibleIds.length > 0 && visibleIds.every(id => selection.selected?.has(id));
  return (
    <Stack id={selection.controlsId} direction="row" useFlexGap sx={{
      alignItems: 'center', flexWrap: 'wrap', columnGap: 0.5, px: 1, py: 0.5, flexShrink: 0,
    }}>
      <Typography variant="body2" role="status">
        {t('library.batchImport.selected', { count: selection.selected.size })}
      </Typography>
      <Button size="small" disabled={visibleIds.length === 0}
        onClick={() => selection.setSelected(visibleIds, !allVisible)}>
        {t(allVisible ? 'library.batchImport.clearVisible' : 'library.batchImport.selectVisible', { count: visibleIds.length })}
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
  return (
    <Box component="li" sx={{
      display: 'flex', alignItems: 'center', minWidth: 0,
      '& > :last-child': { flex: 1, minWidth: 0 },
    }}>
      {crop && id !== undefined ? (
        <Checkbox
          size="small"
          checked={selection.selected.has(id)}
          slotProps={{ input: { 'aria-label': t('library.batchImport.selectNamed', { name: getCropDisplayName(crop) }) } }}
          sx={{ width: 44, height: 44, flexShrink: 0 }}
          onChange={(_, checked) => selection.setSelected([id], checked)}
        />
      ) : <Box sx={{ width: 44, flexShrink: 0 }} />}
      {children}
    </Box>
  );
}
