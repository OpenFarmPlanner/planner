import { Alert, Box, Button, FormControlLabel, InputAdornment, Stack, Switch, TextField, Typography } from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { projectAPI, type ProjectSchedulingSettings } from '../api/api';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { compactFieldSx } from '../components/forms/formLayout';
import { SettingsSection } from '../components/settings/SettingsSection';
import { settingsActionButtonSx, settingsFlatAlertSx } from '../components/settings/settingsStyles';
import { useTranslation } from '../i18n';
import { showGlobalSnackbar } from '../utils/globalSnackbar';

const MAX_MIN_DAYS = 365;

const DEFAULT_SETTINGS: ProjectSchedulingSettings = {
  allow_succession_during_harvest: true,
  succession_min_days_after_harvest_start: 14,
};

const parseMinDays = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const days = Number(value.trim());
  return days <= MAX_MIN_DAYS ? days : null;
};

interface ProjectSettingsSchedulingSectionProps {
  id: string;
  projectId: number;
  canEdit: boolean;
}

/**
 * "Anbauplanung": whether a follow-up crop may take over a bed during the
 * harvest phase of the previous crop, and how many days after its harvest
 * start (docs/bed-occupancy.md). The plans recompute their overlap infos on
 * every load, so nothing else has to refresh after saving.
 */
export function ProjectSettingsSchedulingSection({ id, projectId, canEdit }: ProjectSettingsSchedulingSectionProps) {
  const { t } = useTranslation(['projectInvitations', 'common']);
  const [saved, setSaved] = useState<ProjectSchedulingSettings>(DEFAULT_SETTINGS);
  const [allowDraft, setAllowDraft] = useState(DEFAULT_SETTINGS.allow_succession_during_harvest);
  const [minDaysDraft, setMinDaysDraft] = useState(String(DEFAULT_SETTINGS.succession_min_days_after_harvest_start));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await projectAPI.get(projectId);
        if (cancelled) {
          return;
        }
        const loaded = {
          allow_succession_during_harvest: data.allow_succession_during_harvest,
          succession_min_days_after_harvest_start: data.succession_min_days_after_harvest_start,
        };
        setSaved(loaded);
        setAllowDraft(loaded.allow_succession_during_harvest);
        setMinDaysDraft(String(loaded.succession_min_days_after_harvest_start));
        setError(null);
      } catch {
        if (!cancelled) {
          setError(t('scheduling.loadError'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  const minDays = parseMinDays(minDaysDraft);
  const minDaysInvalid = allowDraft && minDays === null;
  const hasChanges = allowDraft !== saved.allow_succession_during_harvest
    || minDaysDraft.trim() !== String(saved.succession_min_days_after_harvest_start);
  const disabledReason = isSaving
    ? t('common:disabledReasons.busy')
    : !hasChanges
      ? t('common:disabledReasons.noChanges')
      : '';

  const handleCancel = (): void => {
    setAllowDraft(saved.allow_succession_during_harvest);
    setMinDaysDraft(String(saved.succession_min_days_after_harvest_start));
    setError(null);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canEdit || isSaving || !hasChanges || minDaysInvalid) {
      return;
    }
    const next: ProjectSchedulingSettings = {
      allow_succession_during_harvest: allowDraft,
      // A switched-off rule keeps its last valid gap for when it is switched on again.
      succession_min_days_after_harvest_start: minDays ?? saved.succession_min_days_after_harvest_start,
    };
    setIsSaving(true);
    setError(null);
    try {
      await projectAPI.update(projectId, next);
      setSaved(next);
      setMinDaysDraft(String(next.succession_min_days_after_harvest_start));
      showGlobalSnackbar({ message: t('general.saved'), severity: 'success' });
    } catch {
      setError(t('general.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const minDaysField = (
    <TextField
      label={t('scheduling.minDays')}
      value={minDaysDraft}
      onChange={(event) => setMinDaysDraft(event.target.value)}
      disabled={!canEdit || isSaving || !allowDraft}
      error={minDaysInvalid}
      helperText={minDaysInvalid ? t('scheduling.minDaysInvalid') : undefined}
      sx={compactFieldSx}
      slotProps={{
        htmlInput: { inputMode: 'numeric', 'data-testid': 'succession-min-days-input' },
        input: { endAdornment: <InputAdornment position="end">{t('scheduling.daysUnit')}</InputAdornment> },
      }}
    />
  );

  return (
    <SettingsSection
      id={id}
      title={t('scheduling.title')}
      actions={canEdit ? (
        <>
          <DisabledActionTooltip title={disabledReason}>
            <Button
              onClick={handleCancel}
              disabled={isSaving || !hasChanges}
              aria-label={t('scheduling.cancelAriaLabel')}
              sx={settingsActionButtonSx}
            >
              {t('general.cancel')}
            </Button>
          </DisabledActionTooltip>
          <DisabledActionTooltip title={disabledReason}>
            <Button
              type="submit"
              form="project-scheduling-form"
              variant="contained"
              disabled={isSaving || !hasChanges || minDaysInvalid}
              aria-label={t('scheduling.saveAriaLabel')}
              sx={settingsActionButtonSx}
            >
              {t('general.save')}
            </Button>
          </DisabledActionTooltip>
        </>
      ) : undefined}
    >
      <Stack
        component="form"
        id="project-scheduling-form"
        noValidate
        spacing={2}
        onSubmit={(event) => void handleSave(event)}
      >
        <FormControlLabel
          control={(
            <Switch
              checked={allowDraft}
              onChange={(event) => setAllowDraft(event.target.checked)}
              disabled={!canEdit || isSaving}
            />
          )}
          label={t('scheduling.allowSuccession')}
        />
        <Box>
          <DisabledActionTooltip title={allowDraft ? '' : t('scheduling.minDaysDisabled')}>
            {minDaysField}
          </DisabledActionTooltip>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('scheduling.minDaysHelp')}
          </Typography>
        </Box>
        {error ? <Alert severity="error" sx={settingsFlatAlertSx}>{error}</Alert> : null}
      </Stack>
    </SettingsSection>
  );
}
