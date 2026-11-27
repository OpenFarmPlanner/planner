import { Alert, Box, Stack, Typography } from '@mui/material';
import type { ParcelRotationIssue, ParcelRotationSummary } from '../api/types';
import { useTranslation } from '../i18n';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import { SeasonCopyCheckbox, SeasonCopyDetails } from './SeasonCopyPreviewSection';
import { SeasonCopyRotationSummary } from './SeasonCopyRotationSummary';

/** Whether the rotation option and its preview have anything to show. */
function hasParcelRotationContent(report: ParcelRotationSummary | null | undefined, checked: boolean) {
  return Boolean(report && (checked || report.mappings.length > 0 || report.issues.length > 0));
}

interface ParcelRotationCopyToggleProps {
  report: ParcelRotationSummary | null | undefined;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

/** The "apply parcel rotation" option; why it is unavailable stays visible, not tooltip-only. */
export function ParcelRotationCopyToggle({ report, checked, disabled, onChange }: ParcelRotationCopyToggleProps) {
  const { t } = useTranslation(['hierarchy', 'navigation']);
  if (!report || !hasParcelRotationContent(report, checked)) return null;
  const configurationInvalid = report.issues.some(issue => issue.code === 'unequal_bed_counts');
  return (
    <Box>
      <SeasonCopyCheckbox label={t('parcelRotation.copyToggle')} checked={report.eligible && checked}
        help={report.eligible ? t('parcelRotation.copyHelp') : undefined} onChange={onChange}
        disabled={disabled || !report.eligible || (configurationInvalid && !checked)} />
      {!report.eligible && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4 }}>
          {t('navigation:seasonSwitcher.copyDialog.parcelRotationUnavailable')}
        </Typography>
      )}
    </Box>
  );
}

function useIssueMessage() {
  const { t } = useTranslation('hierarchy');
  const locale = getActiveFormattingLocale();
  return (issue: ParcelRotationIssue) => {
    if (issue.code === 'unequal_bed_counts') {
      return t('parcelRotation.unequal', {
        group: issue.group,
        counts: issue.parcels.map(parcel => `${parcel.name} (${formatLocalizedNumber(parcel.count, locale)})`)
          .join(', '),
      });
    }
    if (issue.code === 'missing_bed_area') return t('parcelRotation.missingArea', issue);
    if (issue.code === 'bed_placement_incompatible') return t('parcelRotation.incompatiblePlacement', issue);
    return t('parcelRotation.noCapacity', issue);
  };
}

/** All reasons that block the rotation in one warning: a count, with the details on demand. */
function ParcelRotationIssues({ issues }: { issues: readonly ParcelRotationIssue[] }) {
  const { t } = useTranslation('hierarchy');
  const message = useIssueMessage();
  const messages = [...new Set(issues.map(message))];
  if (messages.length === 0) return null;
  return (
    <Alert severity="warning" sx={{ overflowWrap: 'anywhere', '& .MuiAlert-message': { minWidth: 0 } }}
      data-testid="parcel-rotation-issues">
      {messages.length === 1 ? messages[0] : (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('parcelRotation.issueCount', { count: messages.length })}
          </Typography>
          <SeasonCopyDetails label={t('parcelRotation.showIssues')} inAlert>
            {messages.map(text => <Typography component="li" variant="body2" key={text}>{text}</Typography>)}
          </SeasonCopyDetails>
        </>
      )}
    </Alert>
  );
}

interface ParcelRotationCopyPreviewProps {
  report: ParcelRotationSummary | null | undefined;
  checked: boolean;
  /** Shows the rotated crop-rotation check too; the existing-season dialog shows it with its treatment choice. */
  showCropRotation?: boolean;
}

/** The rotation part of the preview: blocking issues, parcel mappings, unchanged plans and move details. */
export function ParcelRotationCopyPreview({ report, checked, showCropRotation }: ParcelRotationCopyPreviewProps) {
  const { t } = useTranslation(['hierarchy', 'plantingPlans']);
  if (!report || !hasParcelRotationContent(report, checked)) return null;
  const locale = getActiveFormattingLocale();
  const number = (value: number | null) => value === null
    ? '–' : formatLocalizedNumber(value, locale, { maximumFractionDigits: 3 });
  const cropRotation = report.crop_rotation;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const unchanged = report.unchanged_count ?? 0;
  const mappingCount = report.mappings.length;
  const mappingLabel = t('parcelRotation.mappingCount', { count: mappingCount, formatted: number(mappingCount) });
  const moveLabel = t('parcelRotation.moveDetails', { count: report.moves.length });

  return (
    <Stack spacing={1} sx={{ overflowWrap: 'anywhere' }} data-testid="parcel-rotation-preview">
      <ParcelRotationIssues issues={report.issues} />
      {checked && report.enabled ? (
        <>
          {mappingCount > 0 && (
            <SeasonCopyDetails label={mappingLabel}>
              {report.mappings.map(mapping => (
                <Typography component="li" variant="body2" key={mapping.source_parcel_id}>
                  {mapping.source_parcel} → {mapping.target_parcel}
                </Typography>
              ))}
            </SeasonCopyDetails>
          )}
          {unchanged > 0 && (
            <Typography variant="body2" color="text.secondary">
              {t('parcelRotation.unchangedBeds', { count: unchanged })}
            </Typography>
          )}
          {report.moves.length > 0 ? (
            <SeasonCopyDetails label={moveLabel}>
              {report.moves.map(move => (
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
            </SeasonCopyDetails>
          ) : null}
          {showCropRotation && cropRotation && (cropRotation.conflict_count > 0 || cropRotation.hint_count > 0) ? (
            <SeasonCopyRotationSummary preview={cropRotation} />
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}
