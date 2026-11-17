import { useEffect, useId, useState } from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { AutocompleteActionPaper, AutocompleteActionProvider } from '../components/AutocompleteActionPaper';
import { plantHealthAPI } from '../crop-library/plant-health/api';
import type { PlantHealthEntry } from '../crop-library/plant-health/types';
import { useTranslation } from '../i18n';
import { normalizeSearchText } from '../search/searchText';

export function PlantHealthMappingPicker({ name, value, disabled, onChange, onPropose }: {
  name: string;
  value: Pick<PlantHealthEntry, 'identity_key' | 'name' | 'display_name'> | null;
  disabled: boolean;
  onChange: (value: Pick<PlantHealthEntry, 'identity_key' | 'name' | 'display_name'> | null) => void;
  onPropose: (name: string) => Promise<PlantHealthEntry | null>;
}) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const [query, setQuery] = useState(value?.display_name || value?.name || name);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [submitted, setSubmitted] = useState<PlantHealthEntry[]>([]);
  const [result, setResult] = useState<{ key: string; entries: PlantHealthEntry[]; error: boolean }>();
  const actionId = useId();
  const inputId = useId();
  const key = `${i18n.resolvedLanguage}:${query}:${attempt}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void plantHealthAPI.list({ q: query, include_proposed: true, page_size: 40 }, controller.signal)
        .then(response => { if (!controller.signal.aborted) setResult({ key, entries: response.data.results, error: false }); })
        .catch(() => { if (!controller.signal.aborted) setResult({ key, entries: [], error: true }); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, open, query]);
  const current = result?.key === key ? result : undefined;
  const options = [...new Map([...(current?.entries ?? []), ...submitted].map(entry => [entry.identity_key, entry])).values()];
  const normalized = normalizeSearchText(query.trim());
  const exists = options.some(entry => [entry.name, entry.display_name, entry.scientific_name,
    ...entry.translations.flatMap(row => [row.preferred_name, ...(row.synonyms ?? []), ...Object.values(row.regional_names ?? {})]),
  ].some(text => normalizeSearchText(text || '') === normalized));
  const canPropose = Boolean(normalized && current && !current.error && !exists);
  return <AutocompleteActionProvider action={canPropose ? {
    label: t('plantHealth.publication.proposeName', { name: query.trim() }),
    name: t('plantHealth.publication.proposeName', { name: query.trim() }),
    disabled, id: actionId,
    onClick: () => {
      void onPropose(query.trim()).then(entry => {
        if (entry) { setSubmitted(previous => [...previous, entry]); setAttempt(previous => previous + 1); setOpen(false); }
      });
    },
  } : null}>
    <Autocomplete<Pick<PlantHealthEntry, 'identity_key' | 'name' | 'display_name'> & Partial<PlantHealthEntry>> openOnFocus open={open} onOpen={() => setOpen(true)} onClose={(event, reason) => {
      const target = event && 'relatedTarget' in event ? event.relatedTarget : document.activeElement;
      if (reason === 'blur' && target instanceof HTMLElement && target.id === actionId) return;
      setOpen(false);
    }} clearOnBlur={false}
      value={value} inputValue={query} disabled={disabled} options={options} loading={open && !current}
      id={inputId} slotProps={{ popper: {
        container: () => document.getElementById(inputId)?.closest('[role="dialog"]') ?? document.body,
        popperOptions: { strategy: 'fixed' },
        modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 8 } }],
      } }}
      slots={{ paper: AutocompleteActionPaper }} filterOptions={entries => entries}
      getOptionLabel={entry => entry.display_name || entry.name}
      isOptionEqualToValue={(a, b) => a.identity_key === b.identity_key}
      getOptionDisabled={entry => entry.status !== 'published'}
      onChange={(_, entry) => { onChange(entry); setQuery(entry?.display_name || entry?.name || name); }}
      onInputChange={(_, text, reason) => { if (reason === 'input' || reason === 'clear') setQuery(text); }}
      onKeyDown={event => {
        const button = document.getElementById(actionId);
        if (event.key === 'Tab' && !event.shiftKey && canPropose && button) {
          event.preventDefault(); button.focus();
        }
      }}
      renderOption={(props, entry) => {
        const { key: optionKey, ...rest } = props;
        return <Box component="li" key={optionKey} {...rest} sx={{ overflowWrap: 'anywhere' }}>
          <Box><Typography variant="body2">{entry.display_name || entry.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {[entry.kind ? t(`plantHealthCatalogue.kinds.${entry.kind}`) : '', entry.scientific_name,
                entry.status === 'proposed' ? t('plantHealth.publication.pending') : ''].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        </Box>;
      }}
      noOptionsText={canPropose ? null : t('plantHealthCatalogue.empty')}
      loadingText={t('common:messages.loading')}
      renderInput={params => <TextField {...params} label={t('plantHealth.publication.selectFor', { name })}
        error={Boolean(current?.error)} helperText={current?.error ? t('plantHealth.officialSearchError') : undefined} />}
    />
  </AutocompleteActionProvider>;
}
