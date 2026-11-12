import { Box, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import { specificPropertyDefinitions, type SpecificProperties } from './specificProperties';

export function SpecificPropertiesDetails({ profile, values = {}, variety, t }: {
  profile?: string; values?: SpecificProperties; variety?: string; t: TFunction;
}) {
  const definitions = specificPropertyDefinitions(profile);
  const fields = Object.keys(definitions).filter((key) => values[key] !== undefined && values[key] !== '');
  if (!fields.length) return null;
  return <Box sx={{ mt: 2 }}>
    <Typography variant="h6">{t('specificProperties.title')}</Typography>
    <Typography variant="caption" color="text.secondary">
      {t(variety ? 'specificProperties.varietyValues' : 'specificProperties.cropValues')}
    </Typography>
    <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
      {fields.map((key) => <Box key={key} component="div">
        <Typography component="dt" variant="body2" color="text.secondary">{t(definitions[key].label_key)}</Typography>
        <Typography component="dd" sx={{ m: 0 }}>
          {definitions[key].type === 'enum' ? t(definitions[key].options?.[String(values[key])] ?? 'specificProperties.invalidValue')
            : typeof values[key] === 'boolean' ? t(`detail.boolean.${values[key] ? 'yes' : 'no'}`) : String(values[key])}
        </Typography>
      </Box>)}
    </Box>
  </Box>;
}
