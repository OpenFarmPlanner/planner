import { Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

import { useTranslation } from '../../../i18n';
import type { EffectiveSiteConditions } from '../../../api/types';
import {
  CULTIVATION_ENVIRONMENT_OPTIONS,
  INHERITED_SITE_CONDITION_FIELDS,
  SITE_CONDITION_OPTIONS,
  type InheritedSiteConditionField,
} from '../utils/siteConditions';
import { getSiteConditionFieldLabel, getSiteConditionValueLabel } from '../siteConditionLabels';
import type { HierarchyEntityType } from './hierarchyDetailRoutes';

const EXPOSURE_OPTIONS = ['north', 'south', 'east', 'west', 'flat'] as const;

/** Editable values of a location, field or bed detail page; strings as typed. */
export interface GrowingAreaDetailDraft {
  name: string;
  length_m: string;
  width_m: string;
  light_condition: string;
  soil_moisture: string;
  irrigation: string;
  soil_type: string;
  soil_description: string;
  wind_exposure: string;
  water_supply: string;
  notes: string;
  /** Location only. */
  description: string;
  exposure: string;
  /** Field only. */
  cultivation_environment: string;
}

interface GrowingAreaDetailFormProps {
  type: HierarchyEntityType;
  draft: GrowingAreaDetailDraft;
  onChange: (draft: GrowingAreaDetailDraft) => void;
  inherited: EffectiveSiteConditions;
  nameError?: string;
}

const sectionTitleSx = { mb: 1.5 } as const;
const gridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
  gap: 2,
} as const;

/**
 * Edit mode of the growing-area details: every optional field stays
 * discoverable here, even while it is empty (#1075).
 */
export function GrowingAreaDetailForm({ type, draft, onChange, inherited, nameError }: GrowingAreaDetailFormProps) {
  const { t } = useTranslation(['hierarchy', 'locations', 'common']);
  const set = (key: keyof GrowingAreaDetailDraft) => (value: string): void => onChange({ ...draft, [key]: value });

  const conditionField = (field: InheritedSiteConditionField) => {
    const inheritedValue = inherited[field].value;
    const inheritLabel = type === 'location'
      ? t('hierarchy:siteConditions.notSpecified')
      : t('hierarchy:siteConditions.inheritOption', { value: getSiteConditionValueLabel(t, field, inheritedValue) });
    return (
      <Stack key={field} spacing={0.5}>
        <TextField
          select
          fullWidth
          size="small"
          label={getSiteConditionFieldLabel(t, field)}
          value={draft[field]}
          onChange={(event) => set(field)(event.target.value)}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          data-testid={`detail-input-${field}`}
        >
          <MenuItem value="">{inheritLabel}</MenuItem>
          {SITE_CONDITION_OPTIONS[field].map((value) => (
            <MenuItem key={value} value={value}>{getSiteConditionValueLabel(t, field, value)}</MenuItem>
          ))}
        </TextField>
        {type !== 'location' && draft[field] ? (
          <Box>
            <Button
              size="small"
              startIcon={<RestartAltIcon fontSize="small" />}
              onClick={() => set(field)('')}
              sx={{ textAlign: 'left' }}
            >
              {t('hierarchy:siteConditions.resetToInherited')}
            </Button>
          </Box>
        ) : null}
      </Stack>
    );
  };

  const textArea = (key: keyof GrowingAreaDetailDraft, label: string) => (
    <TextField
      key={key}
      fullWidth
      multiline
      minRows={2}
      size="small"
      label={label}
      value={draft[key]}
      onChange={(event) => set(key)(event.target.value)}
    />
  );

  return (
    <Stack spacing={3}>
      <Box component="section">
        <Typography variant="h6" component="h2" sx={sectionTitleSx}>{t('hierarchy:details.sections.general')}</Typography>
        <Box sx={gridSx}>
          <TextField
            required
            size="small"
            label={t('hierarchy:columns.name')}
            value={draft.name}
            error={Boolean(nameError)}
            helperText={nameError}
            onChange={(event) => set('name')(event.target.value)}
          />
          {type === 'location' ? textArea('description', t('hierarchy:details.fields.description')) : null}
        </Box>
      </Box>

      <Box component="section">
        <Typography variant="h6" component="h2" sx={sectionTitleSx}>{t('hierarchy:details.sections.geometry')}</Typography>
        <Box sx={gridSx}>
          <TextField
            size="small"
            label={t('hierarchy:columns.length')}
            value={draft.length_m}
            onChange={(event) => set('length_m')(event.target.value)}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            size="small"
            label={t('hierarchy:columns.width')}
            value={draft.width_m}
            onChange={(event) => set('width_m')(event.target.value)}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
        </Box>
      </Box>

      <Box component="section">
        <Typography variant="h6" component="h2" sx={sectionTitleSx}>{t('hierarchy:details.sections.siteConditions')}</Typography>
        <Box sx={gridSx}>
          {INHERITED_SITE_CONDITION_FIELDS.map(conditionField)}
        </Box>
      </Box>

      <Box component="section">
        <Typography variant="h6" component="h2" sx={sectionTitleSx}>{t('hierarchy:details.sections.siteDetails')}</Typography>
        <Box sx={gridSx}>
          {type === 'location' ? (
            <TextField
              select
              size="small"
              label={t('hierarchy:siteConditions.labels.exposure')}
              value={draft.exposure}
              onChange={(event) => set('exposure')(event.target.value)}
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            >
              <MenuItem value="">{t('hierarchy:siteConditions.notSpecified')}</MenuItem>
              {EXPOSURE_OPTIONS.map((value) => (
                <MenuItem key={value} value={value}>{t(`locations:exposure.${value}`)}</MenuItem>
              ))}
            </TextField>
          ) : null}
          {type === 'field' ? (
            <TextField
              select
              size="small"
              label={t('hierarchy:siteConditions.labels.cultivation_environment')}
              value={draft.cultivation_environment}
              onChange={(event) => set('cultivation_environment')(event.target.value)}
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            >
              <MenuItem value="">{t('hierarchy:siteConditions.notSpecified')}</MenuItem>
              {CULTIVATION_ENVIRONMENT_OPTIONS.map((value) => (
                <MenuItem key={value} value={value}>
                  {getSiteConditionValueLabel(t, 'cultivation_environment', value)}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {textArea('soil_description', t('hierarchy:siteConditions.labels.soil_description'))}
          {textArea('wind_exposure', t('hierarchy:siteConditions.labels.wind_exposure'))}
          {textArea('water_supply', t('hierarchy:siteConditions.labels.water_supply'))}
        </Box>
      </Box>

      <Box component="section">
        <Typography variant="h6" component="h2" sx={sectionTitleSx}>{t('common:fields.notes')}</Typography>
        <TextField
          fullWidth
          multiline
          minRows={3}
          size="small"
          label={t('common:fields.notes')}
          value={draft.notes}
          onChange={(event) => set('notes')(event.target.value)}
        />
      </Box>
    </Stack>
  );
}
