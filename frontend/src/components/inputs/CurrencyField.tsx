import { useMemo } from 'react';
import { Autocomplete, TextField, type SxProps, type Theme } from '@mui/material';
import { useTranslation } from '../../i18n';

const codes = Intl.supportedValuesOf('currency');

interface CurrencyFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  automaticLabel?: string;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export function CurrencyField({ label, value, onChange, automaticLabel, disabled, sx }: CurrencyFieldProps) {
  const { i18n } = useTranslation();
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? 'de';
  const displayNames = useMemo(() => new Intl.DisplayNames([language], { type: 'currency' }), [language]);
  const currencies = useMemo(() => {
    const available = value && !codes.includes(value) ? [value, ...codes] : codes;
    return automaticLabel !== undefined ? ['', ...available] : available;
  }, [value, automaticLabel]);
  return (
    <Autocomplete
      options={currencies}
      value={value || (automaticLabel !== undefined ? '' : null)}
      disabled={disabled}
      disableClearable={Boolean(value && automaticLabel === undefined)}
      getOptionLabel={(code) => code ? `${code} — ${displayNames.of(code) ?? code}` : automaticLabel ?? ''}
      onChange={(_event, option) => onChange(option ?? '')}
      renderInput={(params) => <TextField {...params} label={label} />}
      sx={sx}
    />
  );
}
