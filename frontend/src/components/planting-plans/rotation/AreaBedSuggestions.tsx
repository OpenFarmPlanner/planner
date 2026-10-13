import { useState } from 'react';
import {
  Box,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';

import type { BedSuggestion } from '../../../api/types';
import { useTranslation } from '../../../i18n';
import { buildBedDisplayLabel } from '../../../pages/plantingPlansUtils';
import { RotationStatusIcon } from './RotationStatusIcon';
import { formatIsoDate, getSuggestionReason, type FamilyNameResolver } from './rotationCopy';

const VISIBLE_SUGGESTION_COUNT = 3;

interface AreaBedSuggestionsProps {
  suggestions: BedSuggestion[];
  /** ISO dates of the checked period. */
  periodStart: string | null;
  periodEnd: string | null;
  selectedBedId: number | null;
  isLoading: boolean;
  isError: boolean;
  cultureLabel: string;
  numberLocale: string;
  familyName: FamilyNameResolver;
  onSelectBed: (suggestion: BedSuggestion) => void;
}

/**
 * Suggested beds across all locations and parcels of the project, as
 * clickable rows. Choosing one only fills the selects above; nothing is saved
 * until "Übernehmen".
 */
export function AreaBedSuggestions({
  suggestions,
  periodStart,
  periodEnd,
  selectedBedId,
  isLoading,
  isError,
  cultureLabel,
  numberLocale,
  familyName,
  onSelectBed,
}: AreaBedSuggestionsProps) {
  const { t, i18n } = useTranslation('plantingPlans');
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? suggestions : suggestions.slice(0, VISIBLE_SUGGESTION_COUNT);
  const title = periodStart && periodEnd
    ? t('rotation.suggestions.periodTitle', {
      start: formatIsoDate(periodStart, i18n.language),
      end: formatIsoDate(periodEnd, i18n.language),
    })
    : t('rotation.suggestions.show');

  return (
    <Box component="section" aria-label={title} data-testid="area-bed-suggestions" sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" component="h3">
        {title}
      </Typography>
      {isLoading ? (
        <Typography variant="body2" color="text.secondary">{t('rotation.suggestions.loading')}</Typography>
      ) : isError ? (
        <Typography variant="body2" color="error">{t('rotation.suggestions.error')}</Typography>
      ) : suggestions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{t('rotation.suggestions.emptyMatching')}</Typography>
      ) : (
        <List dense disablePadding>
          {visible.map((suggestion) => {
            const path = buildBedDisplayLabel(
              suggestion.location_name,
              suggestion.field_name,
              suggestion.bed_name,
              null,
              true,
              numberLocale,
            );
            return (
              <ListItemButton
                key={suggestion.bed_id}
                selected={suggestion.bed_id === selectedBedId}
                onClick={() => onSelectBed(suggestion)}
                data-testid="bed-suggestion"
                data-bed-id={suggestion.bed_id}
                sx={{ alignItems: 'flex-start', borderRadius: 1, px: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 32, mt: 0.5 }}>
                  <RotationStatusIcon
                    status={suggestion.status}
                    fontSize="small"
                    titleAccess={t(`rotation.status.${suggestion.status}`)}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={path}
                  secondary={getSuggestionReason(suggestion, t, familyName, cultureLabel)}
                  slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
                />
              </ListItemButton>
            );
          })}
        </List>
      )}
      {suggestions.length > VISIBLE_SUGGESTION_COUNT ? (
        <Link
          component="button"
          type="button"
          variant="body2"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? t('rotation.suggestions.showLess')
            : t('rotation.suggestions.showAllMatching', { count: suggestions.length })}
        </Link>
      ) : null}
    </Box>
  );
}
