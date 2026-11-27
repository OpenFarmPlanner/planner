import {
  Alert,
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material';

import type { RotationFinding, SeasonCopyPreview, SeasonCopyRotationMode } from '../api/types';
import { useFamilyNameResolver } from '../components/planting-plans/rotation/useFamilyNameResolver';
import { useTranslation } from '../i18n';
import { SeasonCopyDetails } from './SeasonCopyPreviewSection';

const MODE_ORDER: readonly SeasonCopyRotationMode[] = ['without_bed', 'keep', 'skip'];

interface SeasonCopyRotationSummaryProps {
  preview: Pick<SeasonCopyPreview, 'conflict_count' | 'hint_count' | 'conflict_free_count' | 'items'>;
  mode?: SeasonCopyRotationMode;
  parcelRotation?: boolean;
  disabled?: boolean;
  remainingConflicts?: number;
  onModeChange?: (mode: SeasonCopyRotationMode) => void;
}

function useFindingReason() {
  const { t } = useTranslation('navigation');
  const familyName = useFamilyNameResolver();
  return (finding: RotationFinding): string => {
    if (finding.kind === 'family_conflict') {
      return t('seasonSwitcher.copyDialog.rotation.reasonConflict', {
        family: familyName(finding.family_key, finding.family_name),
        year: finding.year,
        earliestYear: finding.earliest_year,
      });
    }
    return finding.kind === 'nutrient_hint' ? t('seasonSwitcher.copyDialog.rotation.reasonHint', {
      previousCulture: finding.previous_crop_label ?? '',
      year: finding.year,
    }) : '';
  };
}

/**
 * The crop rotation part of a season copy preview: the always visible
 * conflict and hint counts, their details on demand and, where the dialog
 * offers it, the treatment of the conflicts. Rendered only with a finding.
 */
export function SeasonCopyRotationSummary({
  preview, mode, parcelRotation, disabled, remainingConflicts, onModeChange,
}: SeasonCopyRotationSummaryProps) {
  const { t } = useTranslation(['navigation', 'hierarchy']);
  const getReason = useFindingReason();
  const conflicts = preview.conflict_count;
  const hints = preview.hint_count;
  const values = { conflicts, ok: preview.conflict_free_count };
  const counts = [
    conflicts > 0 ? t('seasonSwitcher.copyDialog.rotation.conflictCount', { count: conflicts }) : null,
    hints > 0 ? t('seasonSwitcher.copyDialog.rotation.hintCount', { count: hints }) : null,
  ].filter(Boolean).join(' · ');
  if (!counts) return null;

  return (
    <Box data-testid="season-copy-rotation-summary">
      <Alert severity={conflicts > 0 ? 'warning' : 'info'}
        sx={{ boxShadow: 'none', overflowWrap: 'anywhere', '& .MuiAlert-message': { minWidth: 0, flex: 1 } }}>
        {preview.items.length > 0 ? (
          <SeasonCopyDetails label={counts} inAlert>
            {preview.items.map(item => (
              <Box component="li" key={item.source_plan_id}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('seasonSwitcher.copyDialog.rotation.item', { culture: item.crop_label, bed: item.bed_name })}
                </Typography>
                {[...new Set(item.findings.map(getReason).filter(Boolean))].map(reason => (
                  <Typography variant="body2" key={reason}>{reason}</Typography>
                ))}
              </Box>
            ))}
          </SeasonCopyDetails>
        ) : <Typography variant="body2" sx={{ fontWeight: 600 }}>{counts}</Typography>}
      </Alert>

      {conflicts > 0 && mode && onModeChange ? (
        <FormControl sx={{ mt: 1.5 }} disabled={disabled}>
          <FormLabel id="season-copy-rotation-mode-label" sx={{ typography: 'body2' }}>
            {t('seasonSwitcher.copyDialog.rotation.modeLabel', values)}
          </FormLabel>
          <RadioGroup
            aria-labelledby="season-copy-rotation-mode-label"
            value={mode}
            onChange={(event) => onModeChange(event.target.value as SeasonCopyRotationMode)}
          >
            {MODE_ORDER.map((option) => (
              <FormControlLabel
                key={option}
                value={option}
                control={<Radio size="small" />}
                sx={{ alignItems: 'flex-start', mt: 0.5 }}
                label={(
                  <Box sx={{ pt: 0.75 }}>
                    <Typography variant="body2">{parcelRotation && option === 'keep'
                      ? t('hierarchy:parcelRotation.keepProposedBeds')
                      : t(`seasonSwitcher.copyDialog.rotation.modes.${option}.label`)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(`seasonSwitcher.copyDialog.rotation.modes.${option}.description`, values)}
                    </Typography>
                  </Box>
                )}
              />
            ))}
          </RadioGroup>
        </FormControl>
      ) : null}
      {remainingConflicts !== undefined && conflicts > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('seasonSwitcher.copyDialog.rotation.remainingConflictCount', { count: remainingConflicts })}
        </Typography>
      )}
    </Box>
  );
}
