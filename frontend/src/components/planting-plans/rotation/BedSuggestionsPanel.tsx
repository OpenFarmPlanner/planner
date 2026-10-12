import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Link,
  Stack,
  Typography,
  type ChipProps,
} from '@mui/material';

import type { BedSuggestion, BedSuggestionCategory } from '../../../api/types';
import { useTranslation } from '../../../i18n';
import { getSuggestionReason } from './rotationCopy';
import { useBedSuggestions, type RotationInput } from './useRotationQueries';

const VISIBLE_SUGGESTION_COUNT = 5;

const CATEGORY_CHIP_COLOR: Record<BedSuggestionCategory, ChipProps['color']> = {
  good: 'success',
  fits: 'primary',
  hint: 'info',
  no_data: 'default',
  conflict: 'warning',
};

interface BedSuggestionsPanelProps {
  input: RotationInput;
  cultureLabel: string;
  onApplyBed: (bedId: number) => void;
}

const formatBedPath = (suggestion: BedSuggestion): string => (
  [suggestion.location_name, suggestion.field_name, suggestion.bed_name]
    .filter((part) => part)
    .join(' / ')
);

/**
 * Ranked beds for the culture and planting date ("Passende Beete für …"),
 * computed by the backend rotation service. Shows the top five; "Übernehmen"
 * hands the bed back to the surrounding form.
 */
export function BedSuggestionsPanel({ input, cultureLabel, onApplyBed }: BedSuggestionsPanelProps) {
  const { t } = useTranslation('plantingPlans');
  const [showAll, setShowAll] = useState(false);
  const isComplete = Boolean(input.cropId && input.plantingDate);
  const { data, isLoading, isError } = useBedSuggestions(input, isComplete);

  const results = data?.results ?? [];
  const visible = showAll ? results : results.slice(0, VISIBLE_SUGGESTION_COUNT);

  return (
    <Box
      component="section"
      aria-label={t('rotation.suggestions.title', { culture: cultureLabel })}
      data-testid="bed-suggestions-panel"
      sx={{ minWidth: 0 }}
    >
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {t('rotation.suggestions.title', { culture: cultureLabel })}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('rotation.suggestions.subtitle')}
      </Typography>

      {!isComplete ? (
        <Typography variant="body2" color="text.secondary">{t('rotation.suggestions.needsInput')}</Typography>
      ) : isLoading ? (
        <Typography variant="body2" color="text.secondary">{t('rotation.suggestions.loading')}</Typography>
      ) : isError ? (
        <Typography variant="body2" color="error">{t('rotation.suggestions.error')}</Typography>
      ) : results.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{t('rotation.suggestions.empty')}</Typography>
      ) : (
        <Stack component="ul" spacing={1} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {visible.map((suggestion) => {
            const isCurrent = suggestion.bed_id === input.bedId;
            const bedPath = formatBedPath(suggestion);
            return (
              <Box
                component="li"
                key={suggestion.bed_id}
                data-testid="bed-suggestion"
                data-bed-id={suggestion.bed_id}
                sx={{
                  display: 'flex',
                  // Stacked on phones, so the action never squeezes the reason
                  // into a narrow column.
                  flexDirection: { xs: 'column', sm: 'row' },
                  alignItems: 'flex-start',
                  gap: 1,
                  p: 1,
                  border: 1,
                  borderColor: isCurrent ? 'primary.main' : 'divider',
                  borderRadius: 1,
                }}
              >
                <Box sx={{ flex: '1 1 auto', minWidth: 0, width: { xs: '100%', sm: 'auto' } }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {bedPath}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={CATEGORY_CHIP_COLOR[suggestion.category]}
                      label={t(`rotation.suggestions.categories.${suggestion.category}`)}
                    />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {getSuggestionReason(suggestion, t, cultureLabel)}
                  </Typography>
                </Box>
                {isCurrent ? (
                  <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, py: 0.5 }}>
                    {t('rotation.suggestions.current')}
                  </Typography>
                ) : (
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ flexShrink: 0 }}
                    aria-label={t('rotation.suggestions.applyAria', { bed: bedPath })}
                    onClick={() => onApplyBed(suggestion.bed_id)}
                  >
                    {t('rotation.suggestions.apply')}
                  </Button>
                )}
              </Box>
            );
          })}
        </Stack>
      )}

      {results.length > VISIBLE_SUGGESTION_COUNT ? (
        <Link
          component="button"
          type="button"
          variant="body2"
          sx={{ mt: 1 }}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? t('rotation.suggestions.showLess')
            : t('rotation.suggestions.showAll', { count: results.length })}
        </Link>
      ) : null}
    </Box>
  );
}
