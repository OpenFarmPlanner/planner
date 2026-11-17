import { useEffect, useId, useState, type ReactNode } from 'react';
import { Autocomplete, Box, Button, Chip, TextField, Typography, type SxProps, type Theme } from '@mui/material';
import type { PlantHealthSelection, PlantHealthSelections } from '../../api/types';
import type { PlantHealthKind } from '../../crop-library/plant-health/types';
import { plantHealthAPI } from '../../crop-library/plant-health/api';
import { useTranslation } from '../../i18n';
import { textContainsTerm, tokenizeSearchQuery } from '../../search/searchText';
import { normalizePlantHealthSelections, plantHealthDisplayName, plantHealthKey } from '../plantHealth';
import { usePlantHealthNames } from '../usePlantHealthNames';
import { FieldInfoButton } from '../FieldInfoButton';
import LoadRetryButton from '../../components/LoadRetryButton';

type Option = PlantHealthSelection & { display_name?: string; scientific_name?: string; kind?: PlantHealthKind };
interface Props {
  value: PlantHealthSelections | null;
  localOptions: readonly PlantHealthSelection[];
  onChange: (value: PlantHealthSelections | null) => void;
  canInherit: boolean;
  inheritedValue?: PlantHealthSelections | null;
  sx?: SxProps<Theme>;
  error?: string;
  allowLocal?: boolean;
  pinButton?: ReactNode;
  selectionLimit?: number;
  /** Main crop forms use heading help; compact selectors keep their existing layout. */
  contextualHelp?: boolean;
  /** Filter mode: choose only entries already used in this scoped crop collection. */
  existingOptions?: readonly PlantHealthSelection[];
}

export function PlantHealthField({ value, localOptions, onChange, canInherit, inheritedValue, sx, error, allowLocal = true, pinButton, selectionLimit = Infinity, existingOptions, contextualHelp = false }: Props) {
  const { t, i18n } = useTranslation('crops');
  const fieldId = useId();
  const contextual = contextualHelp && existingOptions === undefined;
  const entries = (value ?? inheritedValue)?.entries ?? [];
  const names = usePlantHealthNames(existingOptions ?? entries);
  const allowNewLocal = allowLocal && existingOptions === undefined;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; options: Option[]; error: boolean }>();
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? 'de';
  const key = `${language}:${query}:${attempt}`;
  useEffect(() => {
    if (!open || existingOptions !== undefined) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void plantHealthAPI.list({ q: query, status: 'published', page_size: 40 }, controller.signal)
        .then(response => { if (!controller.signal.aborted) setResult({ key, error: false, options: response.data.results.map(entry => ({
          name: entry.name, catalogue_identity: entry.identity_key, display_name: entry.display_name,
          scientific_name: entry.scientific_name, kind: entry.kind,
        })) }); })
        .catch(() => { if (!controller.signal.aborted) setResult({ key, options: [], error: true }); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, open, query, existingOptions]);
  const current = result?.key === key ? result : undefined;
  const label = (entry: Option | string): string => typeof entry === 'string' ? entry
    : (entry.catalogue_identity ? names.catalogue.get(entry.catalogue_identity)?.display_name : undefined)
      ?? entry.display_name ?? entry.name;
  const existing: Option[] | undefined = existingOptions?.map(entry => {
    const official = entry.catalogue_identity ? names.catalogue.get(entry.catalogue_identity) : undefined;
    return { ...entry, display_name: official?.display_name, scientific_name: official?.scientific_name, kind: official?.kind };
  }).filter(entry => {
    const official = entry.catalogue_identity ? names.catalogue.get(entry.catalogue_identity) : undefined;
    const texts = [entry.name, official?.name ?? '', official?.display_name ?? '', official?.scientific_name ?? '', official?.eppo_code ?? '',
      ...(official?.translations.flatMap(row => [row.preferred_name, ...(row.synonyms ?? []), ...Object.values(row.regional_names ?? {})]) ?? [])];
    return tokenizeSearchQuery(query).every(term => texts.some(text => textContainsTerm(text, term)));
  });
  const options: Option[] = existing ?? [
    ...(allowLocal ? localOptions.filter(entry => tokenizeSearchQuery(query).every(term => textContainsTerm(entry.name, term))) : []),
    ...(current?.options ?? []),
  ];
  return <Box sx={sx}>
    {contextual ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography component="label" htmlFor={fieldId} id={`${fieldId}-label`} variant="body2" color="text.secondary">{t('plantHealth.label')}</Typography>
      <FieldInfoButton contextual
        title={t(allowLocal ? 'plantHealth.helper' : 'plantHealth.officialHelper')}
        ariaLabel={t('form.fieldInfoAriaLabel', { field: t('plantHealth.label') })} />
    </Box> : null}
    <Autocomplete<Option, true, false, boolean>
      id={fieldId} multiple freeSolo={allowNewLocal} loading={names.loading} filterSelectedOptions open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)}
      value={entries} options={options} inputValue={query}
      onInputChange={(_event, input) => setQuery(input)}
      onBlur={() => {
        if (!allowNewLocal || !query.trim()) return;
        onChange({ entries: normalizePlantHealthSelections([...entries, query], localOptions) });
        setQuery('');
      }}
      getOptionLabel={label} isOptionEqualToValue={(a, b) => plantHealthKey(a) === plantHealthKey(b)}
      getOptionDisabled={option => entries.length >= selectionLimit && !entries.some(entry => plantHealthKey(entry) === plantHealthKey(option))}
      filterOptions={items => items}
      groupBy={entry => t(entry.catalogue_identity ? 'plantHealth.catalogue' : 'plantHealth.local')}
      onChange={(_event, selected) => onChange({ entries: normalizePlantHealthSelections(selected, localOptions) })}
      renderOption={(props, option) => {
        const { key: optionKey, ...rest } = props;
        return <Box component="li" key={`${optionKey}:${plantHealthKey(option)}`} {...rest} sx={{ overflowWrap: 'anywhere' }}>
          <Box>
            <Typography component="span" variant="body2">{label(option)}</Typography>
            {option.kind ? <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {[t(`plantHealthCatalogue.kinds.${option.kind}`), option.scientific_name || (option.name !== label(option) ? option.name : '')].filter(Boolean).join(' · ')}
            </Typography> : null}
          </Box>
        </Box>;
      }}
      renderValue={(selected, getItemProps) => selected.map((entry, index) => {
        const { key: itemKey, ...rest } = getItemProps({ index });
        const selection = typeof entry === 'string' ? { name: entry } : entry;
        const origin = !selection.catalogue_identity ? 'local'
          : !names.loading && !names.catalogue.has(selection.catalogue_identity) ? 'unavailable' : 'catalogue';
        return <Chip key={itemKey} {...rest} size="small"
          label={`${selection.catalogue_identity && names.catalogue.has(selection.catalogue_identity) ? plantHealthDisplayName(selection, entries, names.catalogue) : label(entry)} · ${t(`plantHealth.${origin}`)}`}
          sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.5 } }} />;
      })}
      renderInput={params => <TextField {...params} label={contextual ? undefined : t('plantHealth.label')}
        slotProps={{ ...params.slotProps, inputLabel: { ...params.slotProps.inputLabel, shrink: true },
          htmlInput: { ...params.slotProps.htmlInput, ...(contextual ? { 'aria-labelledby': `${fieldId}-label` } : {}) } }}
        placeholder={t(existingOptions ? 'plantHealth.filterPlaceholder' : 'plantHealth.placeholder')} helperText={error ?? (current?.error || names.error ? t(existingOptions ? 'plantHealth.filterSearchError' : allowLocal ? 'plantHealth.searchError' : 'plantHealth.officialSearchError') : contextual ? undefined : t(existingOptions ? 'plantHealth.filterHelper' : allowLocal ? 'plantHealth.helper' : 'plantHealth.officialHelper'))}
        error={Boolean(error)} />}
    />
    {current?.error || names.error ? <LoadRetryButton onClick={() => { setAttempt(value => value + 1); names.retry(); }} /> : null}
    {canInherit || pinButton ? <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      {canInherit ? <Button size="small" onClick={() => onChange(null)} disabled={value === null}>
        {t('plantHealth.inherit')}
      </Button> : null}
      {pinButton}
    </Box> : null}
    {!contextual && existingOptions === undefined ? <Typography variant="caption" color="text.secondary" sx={canInherit || pinButton ? { display: 'block' } : undefined}>
      {t('plantHealth.associationHint')}
    </Typography> : null}
  </Box>;
}
