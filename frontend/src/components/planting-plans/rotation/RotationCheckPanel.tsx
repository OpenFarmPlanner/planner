import { useState } from 'react';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router';

import type { RotationBedHistoryEntry, RotationFinding } from '../../../api/types';
import { useTranslation } from '../../../i18n';
import { RotationStatusIcon } from './RotationStatusIcon';
import {
  formatIsoDate,
  getConflictText,
  getCropSettingsPath,
  getInfoText,
  getOkText,
  getPrimaryFinding,
  type FamilyNameResolver,
} from './rotationCopy';
import { useFamilyNameResolver } from './useFamilyNameResolver';
import { useRotationCheck, type RotationInput } from './useRotationQueries';

export interface RotationAcceptanceControls {
  /** Current (possibly unsaved) acceptance in the form. */
  accepted: boolean;
  /**
   * The stored acceptance, when it still applies to the form's crop, bed and
   * dates. Shown as "bewusst akzeptiert"; null while the acceptance is new.
   */
  persisted: { userLabel: string | null; acceptedAt: string | null } | null;
  onChange: (accepted: boolean) => void;
}

interface RotationCheckPanelProps {
  input: RotationInput;
  bedLabel: string;
  cultureLabel: string;
  /** Omitted where the flow cannot store an acceptance (e.g. "Anbaufläche ändern"). */
  acceptance?: RotationAcceptanceControls;
  onShowSuggestions?: () => void;
}

const linkRowSx = { display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, mt: 1 } as const;
const neutralAlertSx = {
  color: 'text.primary',
  borderColor: 'divider',
  boxShadow: 'none',
  '& .MuiAlert-icon': { color: 'action.active' },
} as const;
const inlineAlertSx = { boxShadow: 'none' } as const;

interface BedHistoryListProps {
  bedLabel: string;
  entries: RotationBedHistoryEntry[];
  familyName: FamilyNameResolver;
}

function BedHistoryList({ bedLabel, entries, familyName }: BedHistoryListProps) {
  const { t } = useTranslation('plantingPlans');
  return (
    <Box sx={{ mt: 1 }} data-testid="rotation-bed-history">
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {t('rotation.bedHistory.title', { bed: bedLabel })}
      </Typography>
      {entries.length === 0 ? (
        <Typography variant="body2">{t('rotation.bedHistory.empty')}</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {entries.map((entry, index) => {
            const years = entry.first_year === entry.last_year
              ? String(entry.first_year)
              : `${entry.first_year}–${entry.last_year}`;
            const family = familyName(entry.family_key, entry.family_name);
            return (
              <Typography component="li" variant="body2" key={`${entry.plan_id ?? 'new'}-${index}`}>
                {family
                  ? t('rotation.bedHistory.entryWithFamily', { years, culture: entry.crop_label, family })
                  : t('rotation.bedHistory.entry', { years, culture: entry.crop_label })}
              </Typography>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function CropSettingsLink({ finding, label }: { finding: RotationFinding; label: string }) {
  if (!finding.settings_crop_id) {
    return null;
  }
  return (
    <Link component={RouterLink} to={getCropSettingsPath(finding.settings_crop_id)} variant="body2" color="inherit">
      {label}
    </Link>
  );
}

/**
 * The crop rotation check under the planting-plan date fields: a warning
 * Alert for a conflict (with links and the accept checkbox), an outlined one
 * for an accepted conflict, an info Alert for a nutrient hint, a neutral one
 * when the check is not possible, and a one-line success note otherwise.
 * Never blocks saving.
 */
export function RotationCheckPanel({
  input,
  bedLabel,
  cultureLabel,
  acceptance,
  onShowSuggestions,
}: RotationCheckPanelProps) {
  const { t, i18n } = useTranslation('plantingPlans');
  const { data, isLoading, isError } = useRotationCheck(input);
  const familyName = useFamilyNameResolver();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  if (!input.cropId || !input.bedId || !input.plantingDate) {
    return null;
  }
  if (isLoading) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="rotation-check-loading">
        {t('rotation.checking')}
      </Typography>
    );
  }
  if (isError || !data) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('rotation.checkError')}
      </Typography>
    );
  }

  const context = { bedLabel, cultureLabel, familyName };
  const finding = getPrimaryFinding(data.findings);
  if (!finding) {
    return null;
  }
  const family = familyName(finding.family_key, finding.family_name);

  if (data.status === 'conflict' && acceptance?.accepted && acceptance.persisted) {
    const date = formatIsoDate(acceptance.persisted.acceptedAt, i18n.language);
    const values = { previousCulture: finding.previous_crop_label ?? '', year: finding.year, date };
    return (
      <Alert
        severity="warning"
        variant="outlined"
        icon={<RotationStatusIcon status="accepted" fontSize="inherit" />}
        sx={inlineAlertSx}
        data-testid="rotation-check-accepted"
        action={(
          <Button color="inherit" size="small" onClick={() => acceptance.onChange(false)}>
            {t('rotation.accepted.revoke')}
          </Button>
        )}
      >
        <AlertTitle>{t('rotation.accepted.title', { family })}</AlertTitle>
        {acceptance.persisted.userLabel
          ? t('rotation.accepted.text', { ...values, user: acceptance.persisted.userLabel })
          : t('rotation.accepted.textWithoutUser', values)}
      </Alert>
    );
  }

  if (data.status === 'conflict') {
    const breakLinkLabel = finding.break_source === 'crop'
      ? t('rotation.conflict.changeBreak', { culture: finding.settings_crop_label ?? cultureLabel })
      : t('rotation.conflict.setBreak', { culture: finding.settings_crop_label ?? cultureLabel });
    return (
      <Box data-testid="rotation-check-conflict">
        <Alert severity="warning" sx={inlineAlertSx}>
          <AlertTitle>{t('rotation.conflict.title', { family })}</AlertTitle>
          {getConflictText(finding, t, context)}
          <Box sx={linkRowSx}>
            {onShowSuggestions ? (
              <Link component="button" type="button" variant="body2" color="inherit" onClick={onShowSuggestions}>
                {t('rotation.conflict.showSuggestions')}
              </Link>
            ) : null}
            <Link
              component="button"
              type="button"
              variant="body2"
              color="inherit"
              aria-expanded={isHistoryOpen}
              onClick={() => setIsHistoryOpen((open) => !open)}
            >
              {isHistoryOpen
                ? t('rotation.conflict.hideBedHistory', { bed: bedLabel })
                : t('rotation.conflict.showBedHistory', { bed: bedLabel })}
            </Link>
            <CropSettingsLink finding={finding} label={breakLinkLabel} />
          </Box>
          {isHistoryOpen ? <BedHistoryList bedLabel={bedLabel} entries={data.bed_history} familyName={familyName} /> : null}
          {acceptance ? (
            <FormControlLabel
              sx={{ mt: 0.5 }}
              control={(
                <Checkbox
                  size="small"
                  color="warning"
                  checked={acceptance.accepted}
                  onChange={(event) => acceptance.onChange(event.target.checked)}
                />
              )}
              label={t('rotation.conflict.acceptLabel')}
            />
          ) : null}
        </Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('rotation.conflict.saveNote')}
        </Typography>
      </Box>
    );
  }

  if (data.status === 'hint') {
    return (
      <Alert severity="info" sx={inlineAlertSx} data-testid="rotation-check-hint">
        <AlertTitle>{t('rotation.hint.title')}</AlertTitle>
        {t('rotation.hint.text', { year: finding.year, previousCulture: finding.previous_crop_label ?? '' })}
      </Alert>
    );
  }

  if (data.status === 'info') {
    const showFamilyLink = finding.kind === 'no_family' || finding.kind === 'no_break';
    return (
      <Alert severity="info" variant="outlined" icon={<HelpOutlineIcon fontSize="inherit" />} sx={neutralAlertSx} data-testid="rotation-check-info">
        <AlertTitle>{t('rotation.info.title')}</AlertTitle>
        {getInfoText(finding, t, context)}
        {showFamilyLink ? (
          <Box sx={linkRowSx}>
            <CropSettingsLink
              finding={finding}
              label={finding.kind === 'no_family'
                ? t('rotation.info.addFamily', { culture: finding.settings_crop_label ?? cultureLabel })
                : t('rotation.conflict.setBreak', { culture: finding.settings_crop_label ?? cultureLabel })}
            />
          </Box>
        ) : null}
      </Alert>
    );
  }

  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }} data-testid="rotation-check-ok">
      <RotationStatusIcon status="ok" fontSize="small" />
      <Typography variant="body2" color="success.dark">
        {getOkText(finding, t, familyName)}
      </Typography>
    </Stack>
  );
}
