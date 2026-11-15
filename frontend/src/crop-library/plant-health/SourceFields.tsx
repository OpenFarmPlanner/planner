import { Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useTranslation } from '../../i18n';
import type { PlantHealthSource } from './types';

export function SourceFields({ value, onChange, disabled = false }: {
  value: PlantHealthSource[]; onChange: (value: PlantHealthSource[]) => void; disabled?: boolean;
}) {
  const { t } = useTranslation('crops');
  const set = (index: number, field: keyof PlantHealthSource, text: string) =>
    onChange(value.map((source, current) => current === index ? { ...source, [field]: text } : source));
  return <Stack spacing={1.5}>
    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{t('plantHealthCatalogue.sources')}</Typography>
    {value.map((source, index) => <Box key={index} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Stack spacing={1.5}>
        <TextField label={t('plantHealthCatalogue.sourceUrl')} value={source.url} type="url" size="small" fullWidth disabled={disabled}
          onChange={event => set(index, 'url', event.target.value)} />
        <TextField label={t('plantHealthCatalogue.sourceTitle')} value={source.title ?? ''} size="small" fullWidth disabled={disabled}
          onChange={event => set(index, 'title', event.target.value)} />
        <TextField label={t('plantHealthCatalogue.sourceEvidence')} value={source.evidence ?? ''} size="small" fullWidth multiline minRows={2} disabled={disabled}
          onChange={event => set(index, 'evidence', event.target.value)} />
        <IconButton aria-label={t('plantHealthCatalogue.removeSource')} disabled={disabled} sx={{ alignSelf: 'flex-end' }}
          onClick={() => onChange(value.filter((_, current) => current !== index))}><DeleteOutlineIcon /></IconButton>
      </Stack>
    </Box>)}
    <Button startIcon={<AddIcon />} disabled={disabled || value.length >= 20} sx={{ alignSelf: 'flex-start' }}
      onClick={() => onChange([...value, { url: '' }])}>{t('plantHealthCatalogue.addSource')}</Button>
  </Stack>;
}
