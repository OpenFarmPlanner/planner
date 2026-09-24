import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import {
  segmentedToggleButtonGroupSx,
  segmentedToggleButtonSx,
} from '../components/buttons/segmentedControlStyles';
import type { PublicCropSyncFieldChange } from '../api/types';
import {
  formatPublicCropValue,
  getPublicCropComparisonFieldLabel,
} from '../crop-library/components/publicCropLibrary/formatters';
import {
  buildUniformSyncChoices,
  getDefaultSyncChoice,
  splitSyncChoices,
  type PublicCropSyncChoice,
  type PublicCropSyncChoices,
} from './publicCropSync';

interface PublicCropSyncPanelProps {
  /** Null while the differences are loading. */
  changes: PublicCropSyncFieldChange[] | null;
  choices: PublicCropSyncChoices;
  onChoicesChange: (choices: PublicCropSyncChoices) => void;
  /** The user's library contributions are queued for moderation. */
  requiresModeration: boolean;
  loadError?: string;
  disabled?: boolean;
}

const DIFF_ROW_SX = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr 1fr', sm: 'minmax(8rem, 0.8fr) 1fr 1fr' },
  columnGap: 1.5,
  rowGap: 0.5,
  px: 2,
  py: 1,
  borderTop: '1px solid',
  borderColor: 'divider',
} as const;

// On phones the field label spans the row above both values.
const LABEL_CELL_SX = { gridColumn: { xs: '1 / -1', sm: 'auto' }, fontWeight: 600 } as const;
const CHOICE_CELL_SX = { gridColumn: '1 / -1', mt: 0.5 } as const;

/**
 * Field-by-field sync between a crop and a public library entry, shared by
 * the link confirmation and the "Bibliothek aktualisieren" flow of the
 * publishing wizard. Every differing field gets one row with both values and
 * a two-way choice; see `publicCropSync.ts` for the preselection rules.
 */
export function PublicCropSyncPanel({
  changes,
  choices,
  onChoicesChange,
  requiresModeration,
  loadError,
  disabled = false,
}: PublicCropSyncPanelProps) {
  const { t } = useTranslation(['crops', 'common']);

  if (loadError) {
    return <Alert severity="error">{loadError}</Alert>;
  }
  if (changes === null) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress color="inherit" size={16} />
        <Typography variant="body2" color="text.secondary">{t('library.sync.loading')}</Typography>
      </Stack>
    );
  }
  if (changes.length === 0) {
    return <Alert severity="info">{t('library.sync.noChanges')}</Alert>;
  }

  const { pullFields, pushFields } = splitSyncChoices(changes, choices);
  const setChoice = (field: string, choice: PublicCropSyncChoice) => {
    onChoicesChange({ ...choices, [field]: choice });
  };
  const summaryParts = [
    pullFields.length ? t('library.sync.summaryPull', { count: pullFields.length }) : null,
    pushFields.length
      ? t(requiresModeration ? 'library.sync.summaryPropose' : 'library.sync.summaryPush', { count: pushFields.length })
      : null,
  ].filter((part): part is string => part !== null);
  const summary = summaryParts.length === 2
    ? t('library.sync.summaryBoth', { pull: summaryParts[0], push: summaryParts[1] })
    : t('library.sync.summarySingle', { part: summaryParts[0] });

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="outlined"
          disabled={disabled}
          onClick={() => onChoicesChange(buildUniformSyncChoices(changes, 'library'))}
        >
          {t('library.sync.allLibrary')}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={disabled}
          onClick={() => onChoicesChange(buildUniformSyncChoices(changes, 'mine'))}
        >
          {t('library.sync.allMine')}
        </Button>
      </Stack>

      <Box
        aria-label={t('library.sync.ariaLabel')}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
      >
        <Box sx={{ ...DIFF_ROW_SX, borderTop: 'none', bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }} />
          <Typography variant="caption" color="text.secondary">{t('library.sync.columnLibrary')}</Typography>
          <Typography variant="caption" color="text.secondary">{t('library.sync.columnMine')}</Typography>
        </Box>
        <Box component="dl" sx={{ m: 0 }}>
          {changes.map((change) => {
            const label = getPublicCropComparisonFieldLabel(change.field, t);
            const choice = choices[change.field] ?? getDefaultSyncChoice(change);
            const mineButton = (
              <ToggleButton
                value="mine"
                disabled={disabled || !change.pushable}
                sx={segmentedToggleButtonSx}
              >
                {t('library.sync.chooseMine')}
              </ToggleButton>
            );
            return (
              <Box key={change.field} sx={DIFF_ROW_SX} data-testid={`public-crop-sync-row-${change.field}`}>
                <Typography component="dt" variant="body2" sx={LABEL_CELL_SX}>{label}</Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>
                  {formatPublicCropValue(change.field, change.public_value, t)}
                </Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>
                  {formatPublicCropValue(change.field, change.local_value, t)}
                </Typography>
                <Box component="dd" sx={{ ...CHOICE_CELL_SX, m: 0 }}>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    color="primary"
                    fullWidth
                    value={choice}
                    aria-label={t('library.sync.choiceAriaLabel', { field: label })}
                    sx={segmentedToggleButtonGroupSx}
                    onChange={(_, value: PublicCropSyncChoice | null) => {
                      if (value !== null) setChoice(change.field, value);
                    }}
                  >
                    <ToggleButton value="library" disabled={disabled} sx={segmentedToggleButtonSx}>
                      {t('library.sync.chooseLibrary')}
                    </ToggleButton>
                    {change.pushable ? mineButton : (
                      <DisabledActionTooltip
                        fullWidth
                        title={t(change.field === 'name'
                          ? 'library.sync.notPushableName'
                          : 'library.sync.notPushable')}
                      >
                        {mineButton}
                      </DisabledActionTooltip>
                    )}
                  </ToggleButtonGroup>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" data-testid="public-crop-sync-summary" aria-live="polite">
        {summary}
      </Typography>
    </Stack>
  );
}
