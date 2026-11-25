import { Alert, AlertTitle, Stack, Typography } from '@mui/material';
import type { EffectiveSiteCondition, SiteSuitabilityFinding } from '../../../api/types';
import { formatSiteHealthValue } from '../../../crops/siteHealth';
import { useTranslation } from '../../../i18n';
import {
  getInheritedSourceLabel,
  getSiteConditionValueLabel,
  type SiteConditionChoiceField,
} from '../../hierarchy/siteConditionLabels';

export function SiteSuitabilityHints({ findings, scope = 'bed' }: {
  findings?: SiteSuitabilityFinding[];
  scope?: 'bed' | 'field';
}) {
  const { t } = useTranslation(['plantingPlans', 'crops', 'hierarchy']);
  const { t: cropT } = useTranslation('crops');
  if (!findings?.length) return null;

  const conditionLabel = (field: SiteConditionChoiceField, condition: EffectiveSiteCondition) => {
    const value = getSiteConditionValueLabel(t, field, condition.value);
    const source = getInheritedSourceLabel(t, condition, scope);
    return source ? `${value} (${source})` : value;
  };

  return (
    <Alert severity="info" sx={{ boxShadow: 'none' }} data-testid="site-suitability-hints">
      <AlertTitle>{t('siteSuitability.title')}</AlertTitle>
      <Stack spacing={0.5}>
        {findings.map((finding) => (
          <Typography key={finding.code} variant="body2">
            {finding.code === 'light_mismatch'
              ? t(scope === 'field' ? 'siteSuitability.parcelLightMismatch' : 'siteSuitability.lightMismatch', {
                crop: formatSiteHealthValue('light_requirement', finding.crop_light, cropT),
                bed: conditionLabel('light_condition', finding.light),
              })
              : t('siteSuitability.waterMismatch', {
                moisture: conditionLabel('soil_moisture', finding.soil_moisture),
                irrigation: conditionLabel('irrigation', finding.irrigation),
              })}
          </Typography>
        ))}
      </Stack>
    </Alert>
  );
}
