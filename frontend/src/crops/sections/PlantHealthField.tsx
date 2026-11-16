import { useEffect, useState } from 'react';
import { Autocomplete, Box, Button, Chip, TextField, Typography, type SxProps, type Theme } from '@mui/material';
import type { PlantHealthSelection, PlantHealthSelections } from '../../api/types';
import { plantHealthAPI } from '../../crop-library/plant-health/api';
import { useTranslation } from '../../i18n';
import { textContainsTerm, tokenizeSearchQuery } from '../../search/searchText';
import { normalizePlantHealthSelections, plantHealthKey } from '../plantHealth';
import { usePlantHealthNames } from '../usePlantHealthNames';
import LoadRetryButton from '../../components/LoadRetryButton';

type Option = PlantHealthSelection & { display_name?: string };
interface Props {
  value: PlantHealthSelections | null;
  localOptions: readonly PlantHealthSelection[];
  onChange: (value: PlantHealthSelections | null) => void;
  canInherit: boolean;
  inheritedValue?: PlantHealthSelections | null;
  sx?: SxProps<Theme>;
  error?: string;
}

export function PlantHealthField({ value, localOptions, onChange, canInherit, inheritedValue, sx, error }: Props) {
  const { t, i18n } = useTranslation('crops');
  const entries = (value ?? inheritedValue)?.entries ?? [];
  const names = usePlantHealthNames(entries);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; options: Option[]; error: boolean }>();
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? 'de';
  const key = `${language}:${query}:${attempt}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void plantHealthAPI.list({ q: query, status: 'published', page_size: 40 }, controller.signal)
        .then(response => { if (!controller.signal.aborted) setResult({ key, error: false, options: response.data.results.map(entry => ({
          name: entry.name, catalogue_identity: entry.identity_key, display_name: entry.display_name,
        })) }); })
        .catch(() => { if (!controller.signal.aborted) setResult({ key, options: [], error: true }); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, open, query]);
  const current = result?.key === key ? result : undefined;
  const label = (entry: Option | string): string => typeof entry === 'string' ? entry
    : (entry.catalogue_identity ? names.catalogue.get(entry.catalogue_identity)?.display_name : undefined)
      ?? entry.display_name ?? entry.name;
  const options: Option[] = [
    ...localOptions.filter(entry => tokenizeSearchQuery(query).every(term => textContainsTerm(entry.name, term))),
    ...(current?.options ?? []),
  ];
  return <Box sx={sx}>
    <Autocomplete<Option, true, false, true>
      multiple freeSolo filterSelectedOptions open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)}
      value={entries} options={options} inputValue={query}
      onInputChange={(_event, input) => setQuery(input)}
      onBlur={() => {
        if (!query.trim()) return;
        onChange({ entries: normalizePlantHealthSelections([...entries, query], localOptions) });
        setQuery('');
      }}
      getOptionLabel={label} isOptionEqualToValue={(a, b) => plantHealthKey(a) === plantHealthKey(b)}
      filterOptions={items => items}
      groupBy={entry => t(entry.catalogue_identity ? 'plantHealth.catalogue' : 'plantHealth.local')}
      onChange={(_event, selected) => onChange({ entries: normalizePlantHealthSelections(selected, localOptions) })}
      renderOption={(props, option) => {
        const { key: optionKey, ...rest } = props;
        return <Box component="li" key={`${optionKey}:${plantHealthKey(option)}`} {...rest} sx={{ overflowWrap: 'anywhere' }}>{label(option)}</Box>;
      }}
      renderValue={(selected, getItemProps) => selected.map((entry, index) => {
        const { key: itemKey, ...rest } = getItemProps({ index });
        const selection = typeof entry === 'string' ? { name: entry } : entry;
        const origin = !selection.catalogue_identity ? 'local'
          : !names.loading && !names.catalogue.has(selection.catalogue_identity) ? 'unavailable' : 'catalogue';
        return <Chip key={itemKey} {...rest} size="small"
          label={`${label(entry)} · ${t(`plantHealth.${origin}`)}`}
          sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.5 } }} />;
      })}
      renderInput={params => <TextField {...params} label={t('plantHealth.label')}
        placeholder={t('plantHealth.placeholder')} helperText={error ?? (current?.error || names.error ? t('plantHealth.searchError') : t('plantHealth.helper'))}
        error={Boolean(error) || entries.length > 40} />}
    />
    {current?.error || names.error ? <LoadRetryButton onClick={() => { setAttempt(value => value + 1); names.retry(); }} /> : null}
    {canInherit ? <Button size="small" onClick={() => onChange(null)} disabled={value === null}>
      {t('plantHealth.inherit')}
    </Button> : null}
    <Typography variant="caption" color="text.secondary">{t('plantHealth.associationHint')}</Typography>
  </Box>;
}
