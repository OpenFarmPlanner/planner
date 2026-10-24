/**
 * The pending public-library update diff/apply dialog for a linked project crop.
 *
 * It is opened from the badge-row library action when the library is ahead of
 * the local copy (`CropLibraryActionButton`, state "pullUpdate", or the
 * "Update abgelehnt" chip after a decision). The dialog offers three outcomes:
 * applying the update, declining it for exactly this public version
 * ("Ablehnen", which changes nothing locally and retires the "Kultur
 * aktualisieren" button until the public entry changes again), and closing
 * without deciding ("Abbrechen", which stores nothing at all).
 *
 * Locally pinned fields are never part of the update. When the library changed
 * one of them in this version, a separate block names it with the library's old
 * and new value and lets the user release the pin and take the new value too.
 *
 * A field the user changed locally (not pinned) gets its own block with the
 * choice "Bibliothekswert übernehmen" (the default, the update's behaviour so
 * far) or "Nur lokal behalten", which pins the field so the update and later
 * ones leave it alone. This is the pull's only way to pin: the library being
 * ahead blocks the sync dialog where pinning otherwise happens.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import type { Crop, PublicCropPinnedFieldChange, PublicCropUpdateFieldChange } from '../api/types';
import {
  formatPublicCropValue,
  getPublicCropComparisonFieldLabel,
} from '../crop-library/components/publicCropLibrary/formatters';
import type { PublicCropUpdateController } from './usePublicCropUpdate';

interface PublicCropUpdateDialogProps {
  crop: Crop;
  controller: PublicCropUpdateController;
}

const DIFF_ROW_SX = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(8rem, 0.8fr) 1fr 1fr' },
  gap: { xs: 0.5, sm: 1.5 },
  px: 2,
  py: 1,
  borderTop: '1px solid',
  borderColor: 'divider',
  // Grid items default to min-width: auto, which lets long unbroken text
  // overflow its column instead of wrapping; min-width: 0 forces it to wrap.
  '& > *': {
    minWidth: 0,
    overflowWrap: 'break-word',
  },
} as const;

export function PublicCropUpdateDialog({ crop, controller }: PublicCropUpdateDialogProps) {
  const { t } = useTranslation(['crops', 'common']);
  const {
    update,
    isApplying,
    isRejecting,
    closeDiff,
    applyUpdate,
    rejectUpdate,
  } = controller;

  const changes: PublicCropUpdateFieldChange[] = update?.changes ?? [];
  const pinnedChanges: PublicCropPinnedFieldChange[] = update?.pinned_changes ?? [];
  const varietyChange = changes.find((change) => change.field === 'variety');
  const otherChanges = changes.filter((change) => change.field !== 'variety');
  const tableChanges = otherChanges.filter((change) => !change.can_keep_local);
  const keepableChanges = otherChanges.filter((change) => change.can_keep_local);
  const isBusy = isApplying || isRejecting;
  // Pins the user chose to release, per loaded diff: a reopened dialog starts
  // with every pin kept again.
  const [released, setReleased] = useState<{ update: typeof update; fields: string[] }>({ update: null, fields: [] });
  const releasedFields = released.update === update ? released.fields : [];
  const toggleReleased = (field: string, checked: boolean) => {
    const next = checked
      ? [...releasedFields, field]
      : releasedFields.filter((releasedField) => releasedField !== field);
    setReleased({ update, fields: next });
  };
  // Locally changed fields the user keeps ("Nur lokal behalten"), per loaded
  // diff like the released pins; the default takes the library value.
  const [keptLocal, setKeptLocal] = useState<{ update: typeof update; fields: string[] }>({ update: null, fields: [] });
  const keptLocalFields = keptLocal.update === update ? keptLocal.fields : [];
  const setKeepLocal = (field: string, keep: boolean) => {
    const others = keptLocalFields.filter((keptField) => keptField !== field);
    setKeptLocal({ update, fields: keep ? [...others, field] : others });
  };
  const keptPinnedCount = pinnedChanges.length - releasedFields.length;
  const applyCount = changes.length - keptLocalFields.length + releasedFields.length;
  const summaryParts = [
    applyCount ? t('library.publicUpdate.summaryApply', { count: applyCount }) : null,
    keptLocalFields.length ? t('library.publicUpdate.summaryKeptLocal', { count: keptLocalFields.length }) : null,
    keptPinnedCount ? t('library.publicUpdate.summaryPinned', { count: keptPinnedCount }) : null,
  ].filter((part): part is string => part !== null);
  const summary = summaryParts.length === 3
    ? t('library.publicUpdate.summaryTriple', { first: summaryParts[0], second: summaryParts[1], third: summaryParts[2] })
    : summaryParts.length === 2
      ? t('library.publicUpdate.summaryBoth', { apply: summaryParts[0], pinned: summaryParts[1] })
      : summaryParts.length === 1
        ? t('library.publicUpdate.summarySingle', { part: summaryParts[0] })
        : '';
  // Warn only while a local edit would actually be overwritten. A server
  // without per-field flags falls back to the copy-wide flag.
  const hasPerFieldFlags = changes.every((change) => change.locally_changed !== undefined);
  const overwritesLocalChanges = Boolean(update?.has_local_changes) && (
    !hasPerFieldFlags
    || changes.some((change) => change.locally_changed && !keptLocalFields.includes(change.field))
  );

  return (
    <Dialog open={update !== null} onClose={closeDiff} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library.publicUpdate.dialogTitle')}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          {t('library.publicUpdate.dialogDescription', {
            name: update?.public_crop_name ?? crop.name,
          })}
        </Typography>

        {update?.is_rejected ? (
          <Alert severity="info" sx={{ mb: 2 }} data-testid="crop-public-update-rejected-hint">
            {t('library.publicUpdate.rejectedHint')}
          </Alert>
        ) : null}

        {varietyChange ? (
          <Alert severity="info" sx={{ mb: 2 }} data-testid="crop-public-update-variety-change">
            {t('library.importConflictDialog.varietyRenamed', {
              from: formatPublicCropValue('variety', varietyChange.local_value, t),
              to: formatPublicCropValue('variety', varietyChange.public_value, t),
            })}
          </Alert>
        ) : null}

        {tableChanges.length ? (
          <Box
            aria-label={t('library.publicUpdate.changesAriaLabel')}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
          >
            <Box sx={{ ...DIFF_ROW_SX, borderTop: 'none', bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }} />
              <Typography variant="caption" color="text.secondary">
                {t('library.publicUpdate.localValue')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('library.publicUpdate.publicValue')}
              </Typography>
            </Box>
            <Box component="dl" sx={{ m: 0 }}>
              {tableChanges.map((change) => (
                <Box key={change.field} sx={DIFF_ROW_SX}>
                  <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
                    {getPublicCropComparisonFieldLabel(change.field, t)}
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0, color: 'text.secondary' }}>
                    {formatPublicCropValue(change.field, change.local_value, t)}
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                    {formatPublicCropValue(change.field, change.public_value, t)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        ) : null}

        {keepableChanges.length ? (
          <Box
            data-testid="crop-public-update-local-changes"
            sx={{ mt: 2, border: 1, borderColor: 'divider', borderRadius: 1, px: 2, py: 1.5 }}
          >
            <Typography
              variant="subtitle2"
              component="h3"
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}
            >
              <EditOutlinedIcon fontSize="small" aria-hidden />
              {t('library.publicUpdate.localChangesTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('library.publicUpdate.localChangesHint')}
            </Typography>
            {keepableChanges.map((change) => {
              const label = getPublicCropComparisonFieldLabel(change.field, t);
              const keep = keptLocalFields.includes(change.field);
              return (
                <Box key={change.field} data-testid={`crop-public-update-local-${change.field}`} sx={{ '& + &': { mt: 1.5 } }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
                  <Typography variant="body2">
                    {t('library.publicUpdate.pinnedOwnValue', {
                      value: formatPublicCropValue(change.field, change.local_value, t),
                    })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('library.publicUpdate.localChangeLibraryValue', {
                      value: formatPublicCropValue(change.field, change.public_value, t),
                    })}
                  </Typography>
                  <RadioGroup
                    row
                    aria-label={label}
                    value={keep ? 'keep' : 'take'}
                    onChange={(event) => setKeepLocal(change.field, event.target.value === 'keep')}
                  >
                    <FormControlLabel
                      value="take"
                      disabled={isBusy}
                      control={<Radio size="small" />}
                      label={t('library.publicUpdate.localChangeTake')}
                    />
                    <FormControlLabel
                      value="keep"
                      disabled={isBusy}
                      control={<Radio size="small" sx={{ '&.Mui-checked': { color: 'libraryLocal.main' } }} />}
                      label={t('library.publicUpdate.localChangeKeep')}
                    />
                  </RadioGroup>
                </Box>
              );
            })}
          </Box>
        ) : null}

        {pinnedChanges.length ? (
          <Box
            data-testid="crop-public-update-pinned"
            sx={{ mt: 2, border: 1, borderColor: 'libraryLocal.main', borderRadius: 1, px: 2, py: 1.5 }}
          >
            <Typography
              variant="subtitle2"
              component="h3"
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'libraryLocal.main', mb: 1 }}
            >
              <PushPinIcon fontSize="small" aria-hidden />
              {t('library.publicUpdate.pinnedTitle')}
            </Typography>
            {pinnedChanges.map((change) => {
              const newValue = formatPublicCropValue(change.field, change.public_value, t);
              return (
                <Box key={change.field} data-testid={`crop-public-update-pinned-${change.field}`} sx={{ '& + &': { mt: 1.5 } }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {getPublicCropComparisonFieldLabel(change.field, t)}
                  </Typography>
                  <Typography variant="body2">
                    {t('library.publicUpdate.pinnedOwnValue', {
                      value: formatPublicCropValue(change.field, change.local_value, t),
                    })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('library.publicUpdate.pinnedLibraryChange', {
                      from: formatPublicCropValue(change.field, change.previous_public_value, t),
                      to: newValue,
                    })}
                  </Typography>
                  <FormControlLabel
                    control={(
                      <Checkbox
                        size="small"
                        checked={releasedFields.includes(change.field)}
                        disabled={isBusy}
                        onChange={(event) => toggleReleased(change.field, event.target.checked)}
                      />
                    )}
                    label={t('library.publicUpdate.pinnedRelease', { value: newValue })}
                  />
                </Box>
              );
            })}
          </Box>
        ) : null}

        {(pinnedChanges.length || keepableChanges.length) && summary ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 2 }}
            data-testid="crop-public-update-summary"
            aria-live="polite"
          >
            {summary}
          </Typography>
        ) : null}

        {overwritesLocalChanges ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('library.importConflictDialog.updateWarning')}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, flexWrap: 'wrap', gap: 1 }}>
        {/* autoFocus on cancel so a reflexive Enter never overwrites the local copy. */}
        <DisabledActionTooltip title={isBusy ? t('common:disabledReasons.busy') : ''}>
          <Button autoFocus variant="outlined" onClick={closeDiff} disabled={isBusy}>
            {t('common:actions.cancel')}
          </Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip
          title={isBusy
            ? t('common:disabledReasons.busy')
            : update?.is_rejected
              ? t('disabledReasons.alreadyRejected')
              : ''}
        >
          <Button
            variant="outlined"
            color="inherit"
            onClick={rejectUpdate}
            disabled={isBusy || update?.is_rejected}
            startIcon={isRejecting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {isRejecting ? t('library.publicUpdate.rejecting') : t('library.publicUpdate.reject')}
          </Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip title={isBusy ? t('common:disabledReasons.busy') : ''}>
          <Button
            variant="contained"
            color={overwritesLocalChanges ? 'error' : 'primary'}
            onClick={() => applyUpdate({ unpinFields: releasedFields, pinFields: keptLocalFields })}
            disabled={isBusy}
            startIcon={isApplying ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {isApplying ? t('library.publicUpdate.applying') : t('library.publicUpdate.apply')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
