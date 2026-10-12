import { Chip, Stack, type SxProps, type Theme } from '@mui/material';

import { useTranslation } from '../../../i18n';
import { ROTATION_QUICK_FILTERS, type RotationQuickFilter } from './rotationQuickFilters';

interface RotationQuickFiltersProps {
  value: RotationQuickFilter;
  counts: Record<RotationQuickFilter, number>;
  onChange: (filter: RotationQuickFilter) => void;
  sx?: SxProps<Theme>;
}

/** "Alle / Konflikte / Akzeptiert / Nicht prüfbar" — kept in memory only. */
export function RotationQuickFilters({ value, counts, onChange, sx }: RotationQuickFiltersProps) {
  const { t } = useTranslation('plantingPlans');
  return (
    <Stack
      direction="row"
      role="group"
      aria-label={t('rotation.filters.label')}
      data-testid="rotation-quick-filters"
      sx={[{ gap: 1, flexWrap: 'wrap' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {ROTATION_QUICK_FILTERS.map((filter) => {
        const selected = value === filter;
        return (
          <Chip
            key={filter}
            size="small"
            clickable
            color={selected ? 'primary' : 'default'}
            variant={selected ? 'filled' : 'outlined'}
            aria-pressed={selected}
            label={t(`rotation.filters.${filter}`, { count: counts[filter] })}
            onClick={() => onChange(filter)}
          />
        );
      })}
    </Stack>
  );
}
