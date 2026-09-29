import { useEffect, useState } from 'react';
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
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { RichTextViewer } from '../components/data-grid/RichTextViewer';
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

/** Fields whose value is free-form Markdown and may need a collapse toggle when long. */
const RICH_TEXT_SYNC_FIELDS = new Set(['notes']);
const isRichTextSyncField = (field: string): boolean => RICH_TEXT_SYNC_FIELDS.has(field);

const COLLAPSED_LINE_CLAMP = 4;

const ROW_SX = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0.75,
  px: 2,
  py: 1.5,
  borderTop: '1px solid',
  borderColor: 'divider',
} as const;

const VALUE_COLUMNS_SX = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  columnGap: 1.5,
  rowGap: 0.5,
} as const;

const CLAMPED_VALUE_SX = {
  display: '-webkit-box',
  WebkitLineClamp: COLLAPSED_LINE_CLAMP,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
} as const;

const FADE_OVERLAY_SX = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: '1.75rem',
  pointerEvents: 'none',
  background: (theme: Theme) =>
    `linear-gradient(to bottom, ${alpha(theme.palette.background.paper, 0)} 0%, ${theme.palette.background.paper} 90%)`,
} as const;

interface SyncValueColumnProps {
  field: string;
  side: 'library' | 'mine';
  value: unknown;
  isRichText: boolean;
  expanded: boolean;
  onTruncatedChange: (truncated: boolean) => void;
  t: TFunction;
}

/**
 * One value column of a diff row. Plain fields render straight through
 * `formatPublicCropValue`. Rich-text fields render as Markdown and, while
 * collapsed, clamp to `COLLAPSED_LINE_CLAMP` lines; truncation is measured via
 * `scrollHeight`/`clientHeight` (the same technique as `OverflowTooltip`), and
 * only while collapsed — once expanded the clamp is removed, so measuring
 * would always report "not truncated" and could hide the collapse control.
 */
function SyncValueColumn({ field, side, value, isRichText, expanded, onTruncatedChange, t }: SyncValueColumnProps) {
  const [measureElement, setMeasureElement] = useState<HTMLDivElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    if (!measureElement || expanded) {
      return undefined;
    }
    const measure = () => {
      const truncated = measureElement.scrollHeight > measureElement.clientHeight + 1;
      setIsTruncated(truncated);
      onTruncatedChange(truncated);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(measureElement);
    return () => observer.disconnect();
  }, [measureElement, expanded, onTruncatedChange]);

  if (!isRichText) {
    return (
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        {formatPublicCropValue(field, value, t)}
      </Typography>
    );
  }

  const text = value === null || value === undefined || value === '' ? '' : String(value);

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        ref={setMeasureElement}
        data-testid={`public-crop-sync-value-content-${side}-${field}`}
        sx={expanded ? undefined : CLAMPED_VALUE_SX}
      >
        <RichTextViewer value={text} emptyLabel={t('library.publishWizard.comparison.empty')} />
      </Box>
      {!expanded && isTruncated ? <Box aria-hidden sx={FADE_OVERLAY_SX} /> : null}
    </Box>
  );
}

interface SyncFieldRowProps {
  change: PublicCropSyncFieldChange;
  choice: PublicCropSyncChoice;
  disabled: boolean;
  t: TFunction;
  onChoiceChange: (choice: PublicCropSyncChoice) => void;
}

function SyncFieldRow({ change, choice, disabled, t, onChoiceChange }: SyncFieldRowProps) {
  const label = getPublicCropComparisonFieldLabel(change.field, t);
  const isRichText = isRichTextSyncField(change.field);
  const [expanded, setExpanded] = useState(false);
  const [libraryTruncated, setLibraryTruncated] = useState(false);
  const [mineTruncated, setMineTruncated] = useState(false);
  const showExpandToggle = isRichText && (libraryTruncated || mineTruncated);

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
    <Box sx={ROW_SX} data-testid={`public-crop-sync-row-${change.field}`}>
      <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
      <Box component="dd" sx={{ m: 0 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          color="primary"
          fullWidth
          value={choice}
          aria-label={t('library.sync.choiceAriaLabel', { field: label })}
          sx={segmentedToggleButtonGroupSx}
          onChange={(_, value: PublicCropSyncChoice | null) => {
            if (value !== null) onChoiceChange(value);
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
      <Box component="dd" sx={{ ...VALUE_COLUMNS_SX, m: 0 }}>
        <SyncValueColumn
          field={change.field}
          side="library"
          value={change.public_value}
          isRichText={isRichText}
          expanded={expanded}
          onTruncatedChange={setLibraryTruncated}
          t={t}
        />
        <SyncValueColumn
          field={change.field}
          side="mine"
          value={change.local_value}
          isRichText={isRichText}
          expanded={expanded}
          onTruncatedChange={setMineTruncated}
          t={t}
        />
      </Box>
      {showExpandToggle ? (
        <Box component="dd" sx={{ m: 0 }}>
          <Button
            size="small"
            onClick={() => setExpanded((previous) => !previous)}
            data-testid={`public-crop-sync-toggle-${change.field}`}
          >
            {expanded ? t('library.sync.showLessValue') : t('library.sync.showFullValue')}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

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
        <Box sx={{ ...VALUE_COLUMNS_SX, px: 2, py: 1, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary">{t('library.sync.columnLibrary')}</Typography>
          <Typography variant="caption" color="text.secondary">{t('library.sync.columnMine')}</Typography>
        </Box>
        <Box component="dl" sx={{ m: 0 }}>
          {changes.map((change) => (
            <SyncFieldRow
              key={change.field}
              change={change}
              choice={choices[change.field] ?? getDefaultSyncChoice(change)}
              disabled={disabled}
              t={t}
              onChoiceChange={(choice) => setChoice(change.field, choice)}
            />
          ))}
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" data-testid="public-crop-sync-summary" aria-live="polite">
        {summary}
      </Typography>
    </Stack>
  );
}
