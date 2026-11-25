import { useId } from 'react';
import { Alert, Box, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import type { ParcelRotationSummary } from '../api/types';
import { useTranslation } from '../i18n';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import { SeasonCopyRotationSummary } from './SeasonCopyRotationSummary';

interface ParcelRotationCopyPreviewProps {
  report: ParcelRotationSummary | null | undefined;
  checked: boolean;
  disabled: boolean;
  excludedMoves?: readonly number[];
  sourceSeasonLabel?: string;
  onChange: (checked: boolean) => void;
}

export function ParcelRotationCopyPreview({
  report, checked, disabled, excludedMoves, sourceSeasonLabel, onChange,
}: ParcelRotationCopyPreviewProps) {
  const { t } = useTranslation(['hierarchy', 'navigation', 'plantingPlans']);
  const helpId = useId();
  if (!report || (!checked && report.mappings.length === 0 && report.issues.length === 0)) return null;
  const configurationInvalid = report.issues.some(issue => issue.code === 'unequal_bed_counts');
  const locale = getActiveFormattingLocale();
  const number = (value: number | null) => value === null
    ? '–' : formatLocalizedNumber(value, locale, { maximumFractionDigits: 3 });
  const cropRotation = report.crop_rotation;
  const moves = report.moves.filter(move => !excludedMoves?.includes(move.source_plan_id));
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });

  return (
    <Stack spacing={0.75} sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>
      <FormControlLabel sx={{ m: 0, alignItems: 'flex-start' }}
        control={<Checkbox checked={report.eligible && checked} onChange={(_, value) => onChange(value)}
          disabled={disabled || !report.eligible || (configurationInvalid && !checked)}
          slotProps={{ input: { 'aria-describedby': helpId } }} />}
        label={<Typography sx={{ pt: 1 }} variant="body2">
          {t('parcelRotation.copyToggle')}
        </Typography>}
      />
      <Typography id={helpId} variant="caption" color="text.secondary" sx={{ pl: 4.5 }}>
        {report.eligible ? t('parcelRotation.copyHelp')
          : t('navigation:seasonSwitcher.copyDialog.parcelRotationUnavailable')}
      </Typography>
      {report.issues.map((issue, index) => (
        <Alert severity="warning" key={index}>
          {issue.code === 'unequal_bed_counts'
            ? t('parcelRotation.unequal', { group: issue.group,
              counts: issue.parcels.map(parcel => `${parcel.name} (${number(parcel.count)})`).join(', ') })
            : issue.code === 'missing_bed_area' ? t('parcelRotation.missingArea', issue)
              : t('parcelRotation.noCapacity', issue)}
        </Alert>
      ))}
      {checked && report.enabled ? (
        <>
          <Typography variant="subtitle2">{t('parcelRotation.mappings')}</Typography>
          <Box component="ul" sx={{ mt: 0, pl: 3 }}>
            {report.mappings.map(mapping => (
              <Typography component="li" variant="body2" key={mapping.source_parcel_id}>
                {mapping.source_parcel} → {mapping.target_parcel}
              </Typography>
            ))}
          </Box>
          {moves.length > 0 ? (
            <Stack component="ul" spacing={1} sx={{ pl: 2, maxHeight: 280, overflowY: 'auto' }}>
              {moves.map(move => (
                <Box component="li" key={move.source_plan_id}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {move.crop || '–'} · {move.source_bed} → {move.target_bed}
                  </Typography>
                  <Typography variant="body2">{t('parcelRotation.areaChange', {
                    old: number(move.old_area_sqm), next: number(move.new_area_sqm),
                  })}</Typography>
                  {(move.old_plant_count !== null || move.new_plant_count !== null) && (
                    <Typography variant="body2">{t('parcelRotation.countChange', {
                      old: number(move.old_plant_count), next: number(move.new_plant_count),
                    })}</Typography>
                  )}
                  {move.planting_date && (
                    <Typography variant="body2">
                      {t(move.planting_date === move.planned_sowing_date
                        ? 'plantingPlans:columns.sowingDate' : 'plantingPlans:columns.plantingDate')}
                      {' · '}{dateFormat.format(new Date(move.planting_date))}
                    </Typography>
                  )}
                  {move.seed_requirement !== null && (
                    <Typography variant="body2">{t('parcelRotation.seedRequirement', {
                      amount: number(move.seed_requirement),
                      unit: t(move.seed_unit === 'g' ? 'parcelRotation.grams' : 'parcelRotation.seeds'),
                    })}</Typography>
                  )}
                  {move.quantity_override !== null && (
                    <Typography variant="body2">{t('parcelRotation.quantityOverride', {
                      quantity: number(move.quantity_override),
                    })}</Typography>
                  )}
                </Box>
              ))}
            </Stack>
          ) : null}
          {sourceSeasonLabel && cropRotation && cropRotation.items.length > 0 ? (
            <SeasonCopyRotationSummary
              preview={{ ...cropRotation, source_season_label: sourceSeasonLabel }} />
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}
