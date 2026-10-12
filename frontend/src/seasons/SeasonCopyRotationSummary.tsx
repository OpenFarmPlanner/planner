import { useState } from 'react';
import {
  Alert,
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  Link,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';

import type { SeasonCopyPreview, SeasonCopyPreviewItem, SeasonCopyRotationMode } from '../api/types';
import { useTranslation } from '../i18n';

const VISIBLE_ITEM_COUNT = 3;
const MODE_ORDER: readonly SeasonCopyRotationMode[] = ['without_bed', 'keep', 'skip'];

interface SeasonCopyRotationSummaryProps {
  preview: SeasonCopyPreview;
  mode: SeasonCopyRotationMode;
  onModeChange: (mode: SeasonCopyRotationMode) => void;
}

function useItemReason() {
  const { t } = useTranslation('navigation');
  return (item: SeasonCopyPreviewItem): string => {
    const finding = item.findings[0];
    if (!finding) {
      return '';
    }
    if (item.status === 'conflict') {
      return t('seasonSwitcher.copyDialog.rotation.reasonConflict', {
        family: finding.family_name ?? '',
        year: finding.year,
        earliestYear: finding.earliest_year,
      });
    }
    return t('seasonSwitcher.copyDialog.rotation.reasonHint', {
      previousCulture: finding.previous_crop_label ?? '',
      year: finding.year,
    });
  };
}

/**
 * The crop rotation part of "Daten übernehmen": how many copies would break
 * the rotation on their bed in the target season, which ones, and what to do
 * with them. Rendered only when there is at least one conflict or hint.
 */
export function SeasonCopyRotationSummary({ preview, mode, onModeChange }: SeasonCopyRotationSummaryProps) {
  const { t } = useTranslation('navigation');
  const getReason = useItemReason();
  const [showAll, setShowAll] = useState(false);
  const conflicts = preview.conflict_count;
  const hints = preview.hint_count;
  const items = showAll ? preview.items : preview.items.slice(0, VISIBLE_ITEM_COUNT);
  const values = { conflicts, hints, ok: preview.conflict_free_count };

  return (
    <Box data-testid="season-copy-rotation-summary" sx={{ mt: 2 }}>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {t('seasonSwitcher.copyDialog.rotation.summary', {
          count: preview.total,
          source: preview.source_season_label,
        })}
      </Typography>
      <Alert severity={conflicts > 0 ? 'warning' : 'info'} sx={{ mb: 1, boxShadow: 'none' }}>
        {conflicts > 0
          ? t(hints > 0
            ? 'seasonSwitcher.copyDialog.rotation.warningConflictsAndHints'
            : 'seasonSwitcher.copyDialog.rotation.warningConflicts', values)
          : t('seasonSwitcher.copyDialog.rotation.hintsOnly', values)}
      </Alert>
      <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
        {items.map((item) => (
          <Typography component="li" variant="body2" key={item.source_plan_id}>
            <Box component="span" sx={{ fontWeight: 600 }}>
              {t('seasonSwitcher.copyDialog.rotation.item', { culture: item.crop_label, bed: item.bed_name })}
            </Box>
            {': '}
            {getReason(item)}
          </Typography>
        ))}
      </Stack>
      {preview.items.length > VISIBLE_ITEM_COUNT ? (
        <Link component="button" type="button" variant="body2" sx={{ mt: 0.5 }} onClick={() => setShowAll((value) => !value)}>
          {showAll
            ? t('seasonSwitcher.copyDialog.rotation.showLess')
            : conflicts === preview.items.length
              ? t('seasonSwitcher.copyDialog.rotation.showAll', values)
              : t('seasonSwitcher.copyDialog.rotation.showAllItems', { count: preview.items.length })}
        </Link>
      ) : null}

      {conflicts > 0 ? (
        <FormControl sx={{ mt: 2 }}>
          <FormLabel id="season-copy-rotation-mode-label">
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
                    <Typography variant="body2">{t(`seasonSwitcher.copyDialog.rotation.modes.${option}.label`)}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t(`seasonSwitcher.copyDialog.rotation.modes.${option}.description`, values)}
                    </Typography>
                  </Box>
                )}
              />
            ))}
          </RadioGroup>
        </FormControl>
      ) : null}
    </Box>
  );
}
