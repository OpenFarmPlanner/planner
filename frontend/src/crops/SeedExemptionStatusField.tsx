import { useId, useState } from 'react';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { FormControl, IconButton, MenuItem, Stack, Typography } from '@mui/material';
import type { SeedExemptionStatus } from '../api/types';
import { AppTooltip } from '../components/AppTooltip';
import { wideSingleColumnFieldSx } from '../components/forms/formLayout';
import { TypeaheadSelect as Select } from '../components/inputs/TypeaheadSelect';
import { useTranslation } from '../i18n';

interface SeedExemptionStatusFieldProps {
  value: SeedExemptionStatus;
  onChange: (value: SeedExemptionStatus) => void;
}

export function SeedExemptionStatusField({ value, onChange }: SeedExemptionStatusFieldProps) {
  const { t } = useTranslation('crops');
  const labelId = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <FormControl sx={wideSingleColumnFieldSx}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography id={labelId} variant="body2">{t('form.seedExemptionStatus')}</Typography>
        <AppTooltip explanatory describeChild title={t('form.seedExemptionStatusHelp')}
          open={helpOpen} onOpen={() => setHelpOpen(true)} onClose={() => setHelpOpen(false)}>
          <IconButton
            aria-label={t('form.seedExemptionStatusHelpButton')}
            onClick={() => setHelpOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && helpOpen) {
                event.stopPropagation();
                setHelpOpen(false);
              }
            }}
            size="small"
            sx={{ minWidth: 36, minHeight: 36, '@media (pointer: coarse)': { minWidth: 44, minHeight: 44 } }}
          >
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </AppTooltip>
      </Stack>
      <Select
        value={value}
        labelId={labelId}
        onChange={(event) => onChange(event.target.value as SeedExemptionStatus)}
        size="small"
      >
        {(['approved', 'not_approved', 'not_required', 'unknown'] as const).map((option) => (
          <MenuItem key={option} value={option}>{t(`form.seedExemptionStatusOptions.${option}`)}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
