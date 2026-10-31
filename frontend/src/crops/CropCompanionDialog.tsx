import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import axios from 'axios';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { CompanionKind, CompanionReason, Crop, CropCompanion } from '../api/types';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { formRowSx, smallFieldSx, wideFieldSx } from '../components/forms/formLayout';
import { useTranslation } from '../i18n';
import { COMPANION_KINDS, COMPANION_REASONS, companionReasonLabelKey, relationPartner } from './companions';
import type { PlantFamilyCatalog } from './plantFamilies';

type NeighbourOption =
  | { type: 'crop'; cropId: number; label: string }
  | { type: 'family'; familyKey: string; label: string };

export type CompanionDraft = Omit<CropCompanion, 'id'>;

interface CropCompanionDialogProps {
  open: boolean;
  kultur: Crop;
  /** Every crop of the project; the Kulturen among them are offered as neighbours. */
  crops: readonly Crop[];
  families: PlantFamilyCatalog;
  /** The relation being edited; omitted when adding one. */
  relation?: CropCompanion;
  initialKind?: CompanionKind;
  onClose: () => void;
  onSave: (draft: CompanionDraft) => Promise<void>;
}

const isKultur = (crop: Crop): boolean => !(crop.variety || '').trim();

export function CropCompanionDialog({
  open,
  kultur,
  crops,
  families,
  relation,
  initialKind = 'good',
  onClose,
  onSave,
}: CropCompanionDialogProps) {
  const { t } = useTranslation(['crops', 'common']);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  const [kind, setKind] = useState<CompanionKind>(initialKind);
  const [neighbour, setNeighbour] = useState<NeighbourOption | string | null>(null);
  const [neighbourInput, setNeighbourInput] = useState('');
  const [reason, setReason] = useState<CompanionReason>('other');
  const [note, setNote] = useState('');
  const [neighbourError, setNeighbourError] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const options = useMemo<NeighbourOption[]>(() => [
    ...crops
      .filter((crop) => crop.id !== undefined && crop.id !== kultur.id && isKultur(crop))
      .map((crop) => ({ type: 'crop' as const, cropId: crop.id as number, label: crop.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    ...families.families.map((family) => ({
      type: 'family' as const,
      familyKey: family.botanical_name,
      label: families.getName(family.botanical_name),
    })),
  ], [crops, families, kultur.id]);

  useEffect(() => {
    if (!open) return;
    setKind(relation?.kind ?? initialKind);
    setReason(relation?.reason ?? 'other');
    setNote(relation?.note ?? '');
    setNeighbourError('');
    setError('');
    setIsSaving(false);
    if (!relation || kultur.id === undefined) {
      setNeighbour(null);
      setNeighbourInput('');
      return;
    }
    const partner = relationPartner(relation, kultur.id);
    const option = partner.type === 'text'
      ? partner.text
      : options.find((candidate) => (
        partner.type === 'crop'
          ? candidate.type === 'crop' && candidate.cropId === partner.cropId
          : candidate.type === 'family' && candidate.familyKey === partner.familyKey
      )) ?? null;
    setNeighbour(option);
    setNeighbourInput(typeof option === 'string' ? option : option?.label ?? '');
    // Reset only when the dialog opens for another relation, not on every
    // options refresh while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, relation, initialKind, kultur.id]);

  const resolvedNeighbour = neighbour ?? (neighbourInput.trim() || null);
  const canSave = Boolean(resolvedNeighbour) && !isSaving;

  const buildDraft = (target: NeighbourOption | string): CompanionDraft => ({
    crop: kultur.id as number,
    companion_crop: typeof target !== 'string' && target.type === 'crop' ? target.cropId : null,
    companion_family: typeof target !== 'string' && target.type === 'family' ? target.familyKey : null,
    companion_text: typeof target === 'string' ? target.trim() : '',
    kind,
    reason,
    note: note.trim(),
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!resolvedNeighbour) {
      setNeighbourError(t('companions.dialog.neighborRequired'));
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await onSave(buildDraft(resolvedNeighbour));
      onClose();
    } catch (saveError) {
      const data = axios.isAxiosError(saveError) ? saveError.response?.data as Record<string, unknown> | undefined : undefined;
      if (data && 'companion' in data) {
        setNeighbourError(t('companions.duplicate'));
      } else {
        setError(t('companions.saveError'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const disabledReason = isSaving
    ? t('common:disabledReasons.busy')
    : !canSave ? t('common:disabledReasons.requiredFields') : '';

  return (
    <Dialog open={open} onClose={isSaving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} aria-labelledby={titleId}>
      <Box component="form" noValidate onSubmit={(event) => { void handleSubmit(event); }}>
        <DialogTitle id={titleId}>
          {t(relation ? 'companions.dialog.editTitle' : 'companions.dialog.addTitle', { name: kultur.name })}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ ...formRowSx, pt: 1 }}>
            <TextField
              select
              sx={smallFieldSx}
              label={t('companions.dialog.kind')}
              value={kind}
              disabled={isSaving}
              onChange={(event) => setKind(event.target.value as CompanionKind)}
            >
              {COMPANION_KINDS.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(value === 'good' ? 'companions.dialog.kindGood' : 'companions.dialog.kindBad')}
                </MenuItem>
              ))}
            </TextField>
            <Autocomplete<NeighbourOption, false, false, true>
              freeSolo
              sx={wideFieldSx}
              options={options}
              value={neighbour}
              inputValue={neighbourInput}
              disabled={isSaving}
              groupBy={(option) => t(option.type === 'crop' ? 'companions.dialog.groupCrops' : 'companions.dialog.groupFamilies')}
              getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
              isOptionEqualToValue={(option, value) => (
                typeof value !== 'string' && option.type === value.type && option.label === value.label
              )}
              onChange={(_event, value) => {
                setNeighbour(value);
                setNeighbourError('');
              }}
              onInputChange={(_event, value, changeReason) => {
                setNeighbourInput(value);
                if (changeReason === 'input') {
                  setNeighbour(null);
                  setNeighbourError('');
                }
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  required
                  label={t('companions.dialog.neighbor')}
                  error={Boolean(neighbourError)}
                  helperText={neighbourError || t('companions.dialog.neighborHelper')}
                />
              )}
            />
            <TextField
              select
              sx={smallFieldSx}
              label={t('companions.dialog.reason')}
              value={reason}
              disabled={isSaving}
              onChange={(event) => setReason(event.target.value as CompanionReason)}
            >
              {COMPANION_REASONS.map((value) => (
                <MenuItem key={value} value={value}>{t(companionReasonLabelKey(value))}</MenuItem>
              ))}
            </TextField>
            <TextField
              sx={wideFieldSx}
              label={t('companions.dialog.note')}
              value={note}
              disabled={isSaving}
              slotProps={{ htmlInput: { maxLength: 500 } }}
              onChange={(event) => setNote(event.target.value)}
            />
          </Box>
          {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose} disabled={isSaving}>{t('common:actions.cancel')}</Button>
          <DisabledActionTooltip title={disabledReason}>
            <Button
              type="submit"
              variant="contained"
              disabled={!canSave}
              startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {t('common:actions.save')}
            </Button>
          </DisabledActionTooltip>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
