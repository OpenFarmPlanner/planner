import type { ReactNode } from 'react';
import { Box, Button, Checkbox, Stack, Typography } from '@mui/material';
import type { PublicCrop } from '../../api/types';
import { CropSelectionButton } from '../../crops/CropSelectionButton';
import { useTranslation } from '../../i18n';
import type { PublicCropBatchSelection, PublicCropBatchSelectionControls } from '../hooks/usePublicCropBatchSelection';
import { getPublicCropTitle } from '../publicCropDisplay';

export function PublicCropBatchSelectButton({ batch: { attachIcon, canSelect, controlsId, preview, selection, toggleMode }, disabled, onEnter }: {
  batch: PublicCropBatchSelectionControls;
  disabled?: boolean;
  onEnter?: () => void;
}) {
  const { t } = useTranslation('crops');
  if (!canSelect) return null;
  const label = t(preview?.pending ? 'library.batchImport.resumePending' : 'library.batchImport.selectCultures');
  return <CropSelectionButton
    label={label} buttonRef={attachIcon} disabled={disabled} active={Boolean(selection)}
    controlsId={controlsId} pending={preview?.pending}
    onClick={() => {
      if (!selection && !preview?.pending) onEnter?.();
      toggleMode();
    }}
  />;
}

export function PublicCropBatchActions({ batch, loading }: { batch: PublicCropBatchSelectionControls; loading?: boolean }) {
  const { t } = useTranslation('crops');
  if (!batch.selection) return null;
  const allVisible = batch.visibleParents.length > 0 && batch.selectedVisible === batch.visibleParents.length;
  return <Stack id={batch.controlsId} direction="row" useFlexGap sx={{
    alignItems: 'center', flexWrap: 'wrap', columnGap: 0.5, px: 1, py: 0.5, flexShrink: 0,
  }}>
    <Typography variant="body2" role="status">{t('library.batchImport.selected', { count: batch.selection.selected.size })}</Typography>
    <Button size="small" disabled={loading || !batch.visibleParents.length} onClick={batch.toggleVisible}>
      {t(allVisible ? 'library.batchImport.clearVisible' : 'library.batchImport.selectVisible', { count: batch.visibleParents.length })}
    </Button>
    <Button size="small" onClick={batch.cancel}>{t('library.batchImport.cancelSelection')}</Button>
    <Button size="small" variant="contained" disabled={loading || !batch.selection.selected.size} onClick={batch.openPreview}>
      {t('library.batchImport.import')}
    </Button>
  </Stack>;
}

export function PublicCropBatchRow({ selection, crop, children }: {
  selection: PublicCropBatchSelection;
  crop?: PublicCrop;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation('crops');
  return <Box component="li" sx={{ display: 'flex', alignItems: 'center', minWidth: 0, '& > :last-child': { flex: 1, minWidth: 0 } }}>
    {crop && <Checkbox size="small" checked={selection.selected.has(crop.id)}
      slotProps={{ input: { 'aria-label': t('library.batchImport.selectNamed', {
        name: getPublicCropTitle(crop, i18n.resolvedLanguage ?? i18n.language, t('library.translation.missingName')),
      }) } }} sx={{ width: 44, height: 44, flexShrink: 0 }}
      onChange={(_, checked) => selection.toggleCrop(crop, checked)} />}
    {children}
  </Box>;
}
