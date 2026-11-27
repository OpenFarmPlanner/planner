import { useId } from 'react';
import { Button, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useTranslation } from '../i18n';

const MONTH_KEYS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export function SeasonStartMonthField({ month, onChange, disabled }: {
  month: number;
  onChange: (month: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('navigation');
  const id = useId();
  const label = t('seasonPattern.monthLabel');
  return (
    <FormControl fullWidth disabled={disabled}>
      <InputLabel id={id}>{label}</InputLabel>
      <Select labelId={id} label={label} value={month} onChange={event => onChange(Number(event.target.value))}>
        {MONTH_KEYS.map((key, index) => (
          <MenuItem key={key} value={index + 1}>{t(`seasonPattern.months.${key}`)}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export function LegacySeasonPatternNote({ day, month, onUseFirstDay, disabled }: {
  day: number;
  month: number;
  onUseFirstDay?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('navigation');
  if (day === 1) return null;
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="body2" color="text.secondary">
        {t('seasonPattern.legacyDay', { day, month: t(`seasonPattern.months.${MONTH_KEYS[month - 1]}`) })}
      </Typography>
      {onUseFirstDay && <Button size="small" disabled={disabled} onClick={onUseFirstDay}>
        {t('seasonPattern.useFirstDay')}
      </Button>}
    </Stack>
  );
}
