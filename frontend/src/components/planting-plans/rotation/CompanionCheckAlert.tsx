import SpaOutlinedIcon from '@mui/icons-material/SpaOutlined';
import { Alert, AlertTitle, Box, Typography, type SxProps, type Theme } from '@mui/material';

import type { CompanionFinding } from '../../../api/types';
import { companionReasonLabelKey } from '../../../crops/companions';
import { useTranslation } from '../../../i18n';
import { AppTooltip } from '../../AppTooltip';
import { formatIsoDate } from './rotationCopy';
import { useFamilyNameResolver } from './useFamilyNameResolver';

interface CompanionCheckAlertProps {
  findings: CompanionFinding[];
}

/**
 * Companion planting on the selected bed (see docs/crop-companions.md): a
 * warning for bad neighbours in the same period, a short note for good ones.
 * Never blocks saving.
 */
export function CompanionCheckAlert({ findings }: CompanionCheckAlertProps) {
  const { t, i18n } = useTranslation('crops');
  const familyName = useFamilyNameResolver();
  const bad = findings.filter((finding) => finding.kind === 'bad');
  const good = findings.filter((finding) => finding.kind === 'good');

  const describe = (finding: CompanionFinding): string => {
    const period = t('companions.planning.period', {
      crop: finding.other_crop_label,
      start: formatIsoDate(finding.other_start, i18n.language),
      end: formatIsoDate(finding.other_end, i18n.language),
    });
    const reason = finding.reason === 'other' ? '' : t(companionReasonLabelKey(finding.reason));
    const family = finding.via_family_key
      ? t('companions.planning.viaFamily', { family: familyName(finding.via_family_key) })
      : '';
    const detail = [reason, finding.note].filter(Boolean).join(': ');
    return [period, family, detail].filter(Boolean).join(' – ');
  };

  return (
    <>
      {bad.length > 0 ? (
        <Alert severity="warning" sx={{ boxShadow: 'none' }} data-testid="companion-check-bad">
          <AlertTitle>{t('companions.planning.badTitle')}</AlertTitle>
          {bad.map((finding, index) => (
            <Box key={`${finding.other_plan_id}-${index}`}>{describe(finding)}</Box>
          ))}
        </Alert>
      ) : null}
      {good.length > 0 ? (
        <Typography variant="body2" color="success.dark" data-testid="companion-check-good">
          {`${t('companions.planning.goodTitle')}: ${good.map(describe).join('; ')}`}
        </Typography>
      ) : null}
    </>
  );
}

interface CompanionWarningIconProps {
  findings: readonly CompanionFinding[] | null | undefined;
  fontSize?: 'inherit' | 'small';
  sx?: SxProps<Theme>;
}

/**
 * The table cell's and mobile card's marker for bad neighbours on the same
 * bed; the tooltip names them. Renders nothing without any.
 */
export function CompanionWarningIcon({ findings, fontSize = 'small', sx }: CompanionWarningIconProps) {
  const { t } = useTranslation('crops');
  const names = Array.from(new Set(
    (findings ?? []).filter((finding) => finding.kind === 'bad').map((finding) => finding.other_crop_label),
  ));
  if (names.length === 0) {
    return null;
  }
  return (
    <AppTooltip title={t('companions.planning.tableTooltip', { names: names.join(', ') })}>
      <SpaOutlinedIcon
        color="warning"
        fontSize={fontSize}
        role="img"
        aria-label={t('companions.planning.tableAriaLabel')}
        aria-hidden={false}
        data-testid="companion-warning-icon"
        sx={sx}
      />
    </AppTooltip>
  );
}
