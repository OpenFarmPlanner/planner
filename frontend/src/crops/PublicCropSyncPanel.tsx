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
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
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
  canKeepSyncFieldLocally,
  getDefaultSyncChoice,
  splitSyncChoices,
  type PublicCropSyncChoice,
  type PublicCropSyncChoices,
} from './publicCropSync';
import { isEmptyPublicValue } from '../crop-library/components/publicCropLibrary/formatters';
import { libraryLocalTint } from './libraryFieldPin';

interface PublicCropSyncPanelProps {
  /** Null while the differences are loading. */
  changes: PublicCropSyncFieldChange[] | null;
  choices: PublicCropSyncChoices;
  onChoicesChange: (choices: PublicCropSyncChoices) => void;
  /** The user's library contributions are queued for moderation. */
  requiresModeration: boolean;
  loadError?: string;
  disabled?: boolean;
  /**
   * The crop does not exist yet (link on create): "mine" keeps the value in
   * the new crop instead of writing it into the entry right away.
   */
  keepMineLocally?: boolean;
  /**
   * Offer the third choice "Nur lokal" (pin the value, do not share it). Only
   * the sync of an already linked crop does; the column headings then also
   * name the direction of each choice.
   */
  allowLocal?: boolean;
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

const THREE_VALUE_COLUMNS_SX = {
  ...VALUE_COLUMNS_SX,
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  columnGap: { xs: 0.5, sm: 1 },
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
  side: PublicCropSyncChoice;
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
  // "Nur lokal" carries the pin colour, the same one the crop form marks a
  // pinned field with.
  '&[data-selected="true"][data-choice="local"]': {
    borderColor: 'libraryLocal.main',
    bgcolor: (theme: Theme) => libraryLocalTint(theme),
    '& [data-check-slot]': { color: 'libraryLocal.main' },
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
  /** Direction icon and short description, shown when the panel offers three choices. */
  icon?: SvgIconComponent;
  description?: string;
  testId?: string;
}

function SyncColumnHeading({
  label,
  actionLabel,
  disabled,
  onAction,
  icon: Icon,
  description,
  testId,
}: SyncColumnHeadingProps) {
  // Three narrow columns on a phone: the icon moves in front of the label
  // (no check-mark slot) and text wraps instead of running into the next column.
  const compact = Boolean(description);
  return (
    <Box
      sx={compact ? { ...COLUMN_HEADING_SX, px: { xs: 0.5, sm: 1 }, gap: { xs: 0, sm: 0.75 } } : COLUMN_HEADING_SX}
      data-testid={testId}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ ...CHECK_SLOT_SX, color: 'text.secondary', ...(compact ? { display: { xs: 'none', sm: 'inline-flex' } } : {}) }}
      >
        {Icon ? <Icon sx={{ fontSize: '1rem' }} /> : null}
      </Box>
      <Box sx={{ ...COLUMN_HEADING_CONTENT_SX, ...(compact ? { overflowWrap: 'anywhere', hyphens: 'auto' } : {}) }}>
        <Typography variant="caption" color="text.secondary" sx={compact ? { fontWeight: 600 } : undefined}>
          {Icon && compact ? (
            <Icon aria-hidden sx={{ display: { xs: 'inline-block', sm: 'none' }, fontSize: '0.875rem', verticalAlign: 'text-bottom', mr: 0.25 }} />
          ) : null}
          {label}
        </Typography>
        {description ? (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
            {description}
          </Typography>
        ) : null}
        <Button
          size="small"
          variant="text"
          disabled={disabled}
          sx={{
            minWidth: 0,
            px: 0,
            py: 0,
            textAlign: 'left',
            ...(compact ? { fontSize: { xs: '0.75rem', sm: undefined }, lineHeight: { xs: 1.25, sm: undefined } } : {}),
          }}
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
      data-choice={value}
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
      <Box component="span" aria-hidden data-check-slot sx={CHECK_SLOT_SX}>
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
  allowLocal: boolean;
  t: TFunction;
  onChoiceChange: (choice: PublicCropSyncChoice) => void;
}

const IDENTITY_FIELDS = new Set(['name', 'variety']);

/** Why "Nur lokal" is unavailable for a field, as an i18n key under `library.sync`. */
function notPinnableReasonKey(change: PublicCropSyncFieldChange): string {
  if (IDENTITY_FIELDS.has(change.field)) return 'notPinnableIdentity';
  if (isEmptyPublicValue(change.local_value)) return 'notPinnableEmpty';
  return 'notPinnableSpeciesInvariant';
}

function SyncFieldRow({ change, choice, disabled, allowLocal, t, onChoiceChange }: SyncFieldRowProps) {
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
  const canKeepLocally = canKeepSyncFieldLocally(change);
  const localOption = allowLocal ? (
    <SyncOption
      name={radioName}
      value="local"
      checked={choice === 'local'}
      disabled={disabled || !canKeepLocally}
      label={t('library.sync.chooseLocal')}
      onSelect={() => onChoiceChange('local')}
    >
      <SyncValueColumn
        field={change.field}
        side="local"
        value={change.local_value}
        isRichText={isRichText}
        expanded={expanded}
        onTruncatedChange={setMineTruncated}
        t={t}
      />
    </SyncOption>
  ) : null;

  return (
    <Box sx={ROW_SX} data-testid={`public-crop-sync-row-${change.field}`}>
      <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
        {label}
        {allowLocal && change.pinned ? (
          <Typography
            component="span"
            variant="caption"
            data-testid={`public-crop-sync-pinned-hint-${change.field}`}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, ml: 1, color: 'libraryLocal.main', fontWeight: 400 }}
          >
            <PushPinIcon aria-hidden sx={{ fontSize: '0.875rem' }} />
            {t('library.sync.previouslyPinned')}
          </Typography>
        ) : null}
      </Typography>
      <Box
        component="dd"
        role="radiogroup"
        aria-label={t('library.sync.choiceAriaLabel', { field: label })}
        sx={{ ...(allowLocal ? THREE_VALUE_COLUMNS_SX : VALUE_COLUMNS_SX), m: 0 }}
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
        {localOption && !canKeepLocally ? (
          <DisabledActionTooltip fullWidth title={t(`library.sync.${notPinnableReasonKey(change)}`)}>
            {localOption}
          </DisabledActionTooltip>
        ) : localOption}
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
 * publishing wizard. Every differing field gets one row whose values are the
 * choice itself — two (library / mine), or three with "Nur lokal" for the sync
 * of a linked crop (`allowLocal`), where already pinned fields are listed too
 * so they can be released; see `publicCropSync.ts` for the preselection rules.
 */
export function PublicCropSyncPanel({
  changes,
  choices,
  onChoicesChange,
  requiresModeration,
  loadError,
  disabled = false,
  keepMineLocally = false,
  allowLocal = false,
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

  const choiceOptions = { allowLocal };
  const { pullFields, pushFields, pinFields } = splitSyncChoices(changes, choices, choiceOptions);
  const setChoice = (field: string, choice: PublicCropSyncChoice) => {
    onChoicesChange({ ...choices, [field]: choice });
  };
  const mineSummaryKey = keepMineLocally
    ? 'library.sync.summaryKeep'
    : (requiresModeration ? 'library.sync.summaryPropose' : 'library.sync.summaryPush');
  const summaryParts = [
    pullFields.length ? t('library.sync.summaryPull', { count: pullFields.length }) : null,
    pushFields.length ? t(mineSummaryKey, { count: pushFields.length }) : null,
    pinFields.length ? t('library.sync.summaryLocal', { count: pinFields.length }) : null,
  ].filter((part): part is string => part !== null);
  const summary = summaryParts.length === 3
    ? t('library.sync.summaryThree', { first: summaryParts[0], second: summaryParts[1], third: summaryParts[2] })
    : summaryParts.length === 2
      ? t('library.sync.summaryBoth', { pull: summaryParts[0], push: summaryParts[1] })
      : t('library.sync.summarySingle', { part: summaryParts[0] });

  const setAll = (choice: PublicCropSyncChoice) => onChoicesChange(buildUniformSyncChoices(changes, choice));

  return (
    <Stack spacing={1}>
      <Box
        aria-label={t('library.sync.ariaLabel')}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
      >
        <Box
          sx={{
            ...(allowLocal ? THREE_VALUE_COLUMNS_SX : VALUE_COLUMNS_SX),
            px: allowLocal ? { xs: 0.5, sm: 1 } : 1,
            py: 0.75,
            bgcolor: 'action.hover',
          }}
        >
          <SyncColumnHeading
            label={t('library.sync.columnLibrary')}
            actionLabel={t('library.sync.allLibrary')}
            disabled={disabled}
            onAction={() => setAll('library')}
            {...(allowLocal ? {
              icon: ArrowDownwardIcon,
              description: t('library.sync.columnLibraryDescription'),
              testId: 'public-crop-sync-heading-library',
            } : {})}
          />
          <SyncColumnHeading
            label={t('library.sync.columnMine')}
            actionLabel={t(allowLocal ? 'library.sync.allShare' : 'library.sync.allMine')}
            disabled={disabled}
            onAction={() => setAll('mine')}
            {...(allowLocal ? {
              icon: ArrowUpwardIcon,
              description: t('library.sync.columnMineDescription'),
              testId: 'public-crop-sync-heading-mine',
            } : {})}
          />
          {allowLocal ? (
            <SyncColumnHeading
              label={t('library.sync.columnLocal')}
              actionLabel={t('library.sync.allLocal')}
              disabled={disabled}
              onAction={() => setAll('local')}
              icon={PushPinOutlinedIcon}
              description={t('library.sync.columnLocalDescription')}
              testId="public-crop-sync-heading-local"
            />
          ) : null}
        </Box>
        <Box component="dl" sx={{ m: 0 }}>
          {changes.map((change) => (
            <SyncFieldRow
              key={change.field}
              change={change}
              choice={choices[change.field] ?? getDefaultSyncChoice(change, choiceOptions)}
              disabled={disabled}
              allowLocal={allowLocal}
              t={t}
              onChoiceChange={(choice) => setChoice(change.field, choice)}
            />
          ))}
        </Box>
      </Box>

      {allowLocal ? (
        <Alert severity="info" icon={<PushPinOutlinedIcon fontSize="inherit" />} data-testid="public-crop-sync-local-info">
          {t('library.sync.localInfo')}
        </Alert>
      ) : null}

      <Typography variant="body2" color="text.secondary" data-testid="public-crop-sync-summary" aria-live="polite">
        {summary}
      </Typography>
    </Stack>
  );
}
