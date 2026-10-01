import { useEffect, useId, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { RichTextViewer } from '../components/data-grid/RichTextViewer';
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
  gap: 0.5,
  px: 1,
  py: 1,
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

/**
 * Fades the last clamped line out. A mask rather than a paper-coloured
 * overlay, so the fade also works on the tinted background of a chosen value.
 */
const FADED_VALUE_SX = {
  maskImage: 'linear-gradient(to bottom, black 60%, transparent)',
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
        sx={expanded ? undefined : { ...CLAMPED_VALUE_SX, ...(isTruncated ? FADED_VALUE_SX : {}) }}
      >
        <RichTextViewer value={text} emptyLabel={t('library.publishWizard.comparison.empty')} />
      </Box>
    </Box>
  );
}

const OPTION_SX = {
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 0.75,
  minWidth: 0,
  px: 1,
  py: 0.75,
  border: '1px solid',
  borderColor: 'transparent',
  borderRadius: 1,
  cursor: 'pointer',
  color: 'text.secondary',
  transition: (theme: Theme) => theme.transitions.create(['background-color', 'border-color']),
  '&:hover': { bgcolor: 'action.hover' },
  '&:has(input:focus-visible)': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: 1,
  },
  '&[data-selected="true"]': {
    color: 'text.primary',
    borderColor: 'primary.main',
    bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity),
  },
  '&[data-disabled="true"]': {
    cursor: 'default',
    '&:hover': { bgcolor: 'transparent' },
  },
} as const;

/** Hides the native radio visually while keeping it focusable and announced. */
const VISUALLY_HIDDEN_STYLE = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/** Keeps the value aligned whether or not the check mark is shown. */
const CHECK_SLOT_SX = {
  display: 'inline-flex',
  flexShrink: 0,
  width: '1rem',
  mt: 0.25,
  color: 'primary.main',
} as const;

/** Mirrors `OPTION_SX` spacing so a heading lines up with the values below it. */
const COLUMN_HEADING_SX = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 0.75,
  minWidth: 0,
  px: 1,
  border: '1px solid',
  borderColor: 'transparent',
} as const;

const COLUMN_HEADING_CONTENT_SX = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  minWidth: 0,
} as const;

interface SyncColumnHeadingProps {
  label: string;
  actionLabel: string;
  disabled: boolean;
  onAction: () => void;
}

function SyncColumnHeading({ label, actionLabel, disabled, onAction }: SyncColumnHeadingProps) {
  return (
    <Box sx={COLUMN_HEADING_SX}>
      <Box component="span" aria-hidden sx={CHECK_SLOT_SX} />
      <Box sx={COLUMN_HEADING_CONTENT_SX}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Button
          size="small"
          variant="text"
          disabled={disabled}
          sx={{ minWidth: 0, px: 0, py: 0, textAlign: 'left' }}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </Box>
    </Box>
  );
}

interface SyncOptionProps {
  name: string;
  value: PublicCropSyncChoice;
  checked: boolean;
  disabled: boolean;
  label: string;
  onSelect: () => void;
  children: ReactNode;
}

/**
 * One side of a diff row: the value itself is the choice. A visually hidden
 * native radio carries focus, keyboard (arrow keys within the row) and the
 * accessible name; the surrounding box only adds the larger click target.
 * Clicks on links inside a Markdown value open the link without switching
 * sides.
 */
function SyncOption({ name, value, checked, disabled, label, onSelect, children }: SyncOptionProps) {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || checked) return;
    if (event.target instanceof Element && event.target.closest('a, input, button')) return;
    onSelect();
  };

  return (
    <Box
      sx={OPTION_SX}
      data-selected={checked}
      data-disabled={disabled}
      data-testid={`public-crop-sync-option-${value}-${name}`}
      onClick={handleClick}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={onSelect}
        style={VISUALLY_HIDDEN_STYLE}
      />
      <Box component="span" aria-hidden sx={CHECK_SLOT_SX}>
        {checked ? <CheckCircleIcon sx={{ fontSize: '1rem' }} /> : null}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>{children}</Box>
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

  const radioId = useId();
  const radioName = `public-crop-sync-${change.field}-${radioId}`;
  const libraryValue = (
    <SyncValueColumn
      field={change.field}
      side="library"
      value={change.public_value}
      isRichText={isRichText}
      expanded={expanded}
      onTruncatedChange={setLibraryTruncated}
      t={t}
    />
  );
  const mineValue = (
    <SyncValueColumn
      field={change.field}
      side="mine"
      value={change.local_value}
      isRichText={isRichText}
      expanded={expanded}
      onTruncatedChange={setMineTruncated}
      t={t}
    />
  );
  const mineOption = (
    <SyncOption
      name={radioName}
      value="mine"
      checked={choice === 'mine'}
      disabled={disabled || !change.pushable}
      label={t('library.sync.chooseMine')}
      onSelect={() => onChoiceChange('mine')}
    >
      {mineValue}
    </SyncOption>
  );

  return (
    <Box sx={ROW_SX} data-testid={`public-crop-sync-row-${change.field}`}>
      <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
      <Box
        component="dd"
        role="radiogroup"
        aria-label={t('library.sync.choiceAriaLabel', { field: label })}
        sx={{ ...VALUE_COLUMNS_SX, m: 0 }}
      >
        <SyncOption
          name={radioName}
          value="library"
          checked={choice === 'library'}
          disabled={disabled}
          label={t('library.sync.chooseLibrary')}
          onSelect={() => onChoiceChange('library')}
        >
          {libraryValue}
        </SyncOption>
        {change.pushable ? mineOption : (
          <DisabledActionTooltip
            fullWidth
            title={t(change.field === 'name'
              ? 'library.sync.notPushableName'
              : 'library.sync.notPushable')}
          >
            {mineOption}
          </DisabledActionTooltip>
        )}
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
 * publishing wizard. Every differing field gets one row whose two values are
 * the choice itself; see `publicCropSync.ts` for the preselection rules.
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
      <Box
        aria-label={t('library.sync.ariaLabel')}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
      >
        <Box sx={{ ...VALUE_COLUMNS_SX, px: 1, py: 0.75, bgcolor: 'action.hover' }}>
          <SyncColumnHeading
            label={t('library.sync.columnLibrary')}
            actionLabel={t('library.sync.allLibrary')}
            disabled={disabled}
            onAction={() => onChoicesChange(buildUniformSyncChoices(changes, 'library'))}
          />
          <SyncColumnHeading
            label={t('library.sync.columnMine')}
            actionLabel={t('library.sync.allMine')}
            disabled={disabled}
            onAction={() => onChoicesChange(buildUniformSyncChoices(changes, 'mine'))}
          />
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
