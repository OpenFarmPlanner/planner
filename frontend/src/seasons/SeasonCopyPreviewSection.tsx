import { useId, type ReactNode } from 'react';
import { Box, Checkbox, Divider, FormControlLabel, Stack, Typography } from '@mui/material';
import { FieldInfoIcon } from '../crops/FieldInfoIcon';
import { useTranslation } from '../i18n';

interface SeasonCopyCheckboxProps {
  label: string;
  /** The option's explanation, behind the shared info icon beside (not inside) the label. */
  help?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A copy option with a concise label; the info icon stays out of the checkbox's accessible name. */
export function SeasonCopyCheckbox({ label, help, checked, disabled, onChange }: SeasonCopyCheckboxProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
      <FormControlLabel sx={{ m: 0, alignItems: 'flex-start' }}
        control={<Checkbox checked={checked} disabled={disabled} onChange={(_, value) => onChange(value)}
          sx={{ pt: 0 }} />}
        label={<Typography variant="body2">{label}</Typography>} />
      {help ? <Box component="span" sx={{ pt: 0.125 }}><FieldInfoIcon title={help} /></Box> : null}
    </Box>
  );
}

/** The one preview block of both season copy dialogs, set apart from the options above it. */
export function SeasonCopyPreviewSection({ children }: { children: ReactNode }) {
  const { t } = useTranslation('navigation');
  const headingId = useId();
  return (
    <Stack component="section" aria-labelledby={headingId} spacing={1.5} data-testid="season-copy-preview">
      <Divider />
      <Typography id={headingId} component="h3" variant="subtitle2">
        {t('seasonSwitcher.copyDialog.preview')}
      </Typography>
      {children}
    </Stack>
  );
}
