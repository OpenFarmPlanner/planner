import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Checkbox, FormControlLabel, IconButton, Stack, TextField, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useTranslation } from '../../i18n';
import { getLanguageDisplayName, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n/languages';
import type { PlantHealthTranslation } from './types';

import type { NameDrafts } from './drafts';

export function NameFields({ value, scientificName, onChange, disabled }: {
  value: NameDrafts; scientificName: string; onChange: (value: NameDrafts) => void; disabled: boolean;
}) {
  const { t, i18n } = useTranslation('crops');
  const set = (code: SupportedLanguage, change: Partial<PlantHealthTranslation>) =>
    onChange({ ...value, [code]: { ...value[code], ...change } });
  return <Box>
    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>{t('plantHealthCatalogue.names')}</Typography>
    {SUPPORTED_LANGUAGES.map(({ code, label }) => {
      const row = value[code];
      const regions = Object.entries(row.regional_names ?? {});
      return <Accordion key={code} defaultExpanded={code === (i18n.resolvedLanguage?.split('-')[0] ?? 'en')} disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography sx={{ overflowWrap: 'anywhere' }}>{label}{row.preferred_name ? ` · ${row.preferred_name}` : ''}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1.5}>
            <TextField label={t('plantHealthCatalogue.nameIn', { language: getLanguageDisplayName(code, i18n.resolvedLanguage ?? 'en') })}
              value={row.preferred_name} disabled={disabled || row.is_scientific_fallback} fullWidth size="small"
              slotProps={{ htmlInput: { lang: code, maxLength: 200 } }}
              onChange={event => set(code, { preferred_name: event.target.value })} />
            <TextField label={t('plantHealthCatalogue.synonyms')} helperText={t('plantHealthCatalogue.oneAliasPerLine')}
              value={(row.synonyms ?? []).join('\n')} disabled={disabled} fullWidth multiline size="small"
              slotProps={{ htmlInput: { lang: code } }} onChange={event => set(code, { synonyms: event.target.value.split('\n') })} />
            <FormControlLabel control={<Checkbox checked={Boolean(row.is_scientific_fallback)} disabled={disabled || !scientificName.trim() && !row.is_scientific_fallback}
              onChange={(_, checked) => set(code, { is_scientific_fallback: checked,
                preferred_name: checked ? scientificName.trim() : row.preferred_name,
                fallback_reason: checked ? row.fallback_reason ?? '' : '' })} />}
              label={t('plantHealthCatalogue.scientificFallback')} />
            {row.is_scientific_fallback ? <TextField label={t('plantHealthCatalogue.fallbackReason')} value={row.fallback_reason ?? ''}
              required disabled={disabled} fullWidth size="small" onChange={event => set(code, { fallback_reason: event.target.value })} /> : null}
            <Typography variant="subtitle2">{t('plantHealthCatalogue.regionalNames')}</Typography>
            {regions.map(([country, name], index) => <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
              <TextField label={t('plantHealthCatalogue.countryCode')} value={country} disabled={disabled} size="small" sx={{ width: { xs: '100%', sm: 140 }, flexShrink: 0 }}
                slotProps={{ htmlInput: { maxLength: 2 } }} onChange={event => {
                  const countryCode = event.target.value.toUpperCase();
                  if (regions.some(([existing], current) => current !== index && existing === countryCode)) return;
                  const next = [...regions]; next[index] = [countryCode, name];
                  set(code, { regional_names: Object.fromEntries(next) });
                }} />
              <TextField label={t('plantHealthCatalogue.regionalName')} value={name} disabled={disabled} size="small" fullWidth
                onChange={event => set(code, { regional_names: { ...row.regional_names, [country]: event.target.value } })} />
              <IconButton aria-label={t('plantHealthCatalogue.removeRegion')} disabled={disabled} sx={{ alignSelf: { xs: 'flex-end', sm: 'center' } }}
                onClick={() => set(code, { regional_names: Object.fromEntries(regions.filter((_, current) => current !== index)) })}><DeleteOutlineIcon /></IconButton>
            </Stack>)}
            <Button disabled={disabled || '' in (row.regional_names ?? {}) || regions.length >= 50} sx={{ alignSelf: 'flex-start' }}
              onClick={() => set(code, { regional_names: { ...row.regional_names, '': '' } })}>{t('plantHealthCatalogue.addRegion')}</Button>
          </Stack>
        </AccordionDetails>
      </Accordion>;
    })}
  </Box>;
}
