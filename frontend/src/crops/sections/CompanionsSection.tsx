import DeleteIcon from '@mui/icons-material/Delete';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import type { CompanionKind, CompanionReason } from '../../api/types';
import { AppTooltip } from '../../components/AppTooltip';
import { useTranslation } from '../../i18n';
import { CompanionKindColumns, CompanionKindHeading } from '../CompanionKindColumns';
import { COMPANION_KIND_STYLES } from '../companionKindStyles';
import {
  COMPANION_KINDS,
  COMPANION_REASONS,
  companionReasonLabelKey,
  companionTargetKey,
  emptyCompanionFormRow,
  type CompanionFormOption,
  type CompanionFormRow,
  type CompanionFormTarget,
} from '../companions';
import type { CompanionFormRowsState } from '../useCompanionFormRows';

interface CompanionsSectionProps {
  state: CompanionFormRowsState;
  disabled?: boolean;
}

const ADD_LABEL_KEYS: Record<CompanionKind, string> = {
  good: 'companions.form.addGood',
  bad: 'companions.form.addBad',
};

const MOVE_LABEL_KEYS: Record<CompanionKind, string> = {
  good: 'companions.form.moveToBad',
  bad: 'companions.form.moveToGood',
};

const OTHER_KIND: Record<CompanionKind, CompanionKind> = { good: 'bad', bad: 'good' };

/**
 * "Mischkultur" in the crop form: good and bad neighbours in two groups, one
 * compact row per neighbour, saved with the form (see
 * docs/crop-companions.md#crop-form). A group appears once it has a row; the
 * two add buttons below the groups are always there. A Sorte shows its
 * Kultur's list read-only.
 */
export function CompanionsSection({ state, disabled = false }: CompanionsSectionProps) {
  const { t } = useTranslation(['crops', 'common']);
  const { mode, rows, setRows, options, allowFreeText, errors } = state;
  if (mode === 'hidden') return null;

  if (mode === 'readOnly') {
    if (state.loaded && !state.failed && rows.length === 0) {
      return (
        <Box data-testid="crop-companions-form-section" sx={{ mt: 1 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>{t('companions.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('companions.form.varietyReadOnlyEmpty', { name: state.kulturName })}
          </Typography>
        </Box>
      );
    }
    return (
      <Box data-testid="crop-companions-form-section" sx={{ mt: 1 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>{t('companions.title')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('companions.form.varietyReadOnly', { name: state.kulturName })}
        </Typography>
        <CompanionKindColumns
          items={rows.map((row) => ({
            key: row.key,
            kind: row.kind,
            label: row.target?.label ?? '',
            detail: [row.reason === 'other' ? '' : t(companionReasonLabelKey(row.reason)), row.note]
              .filter(Boolean).join(': '),
          }))}
        />
      </Box>
    );
  }

  const updateRow = (key: string, patch: Partial<CompanionFormRow>) => {
    setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  return (
    <Box data-testid="crop-companions-form-section" sx={{ mt: 1 }}>
      <Typography variant="h6">{t('companions.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t(allowFreeText ? 'companions.form.description' : 'companions.form.libraryDescription')}
      </Typography>
      {state.failed ? <Alert severity="error" sx={{ mb: 1 }}>{t('companions.loadError')}</Alert> : null}
      <Stack spacing={1.5}>
        {/* A group shows only with rows; its heading would otherwise announce an empty list. */}
        {COMPANION_KINDS.map((kind) => {
          const kindRows = rows.filter((row) => row.kind === kind);
          if (kindRows.length === 0) return null;
          return (
            <Box key={kind} data-testid={`companion-form-group-${kind}`}>
              <CompanionKindHeading kind={kind} />
              {kindRows.map((row, index) => (
                <CompanionFormRowFields
                  key={row.key}
                  row={row}
                  divided={index > 0}
                  options={options}
                  allowFreeText={allowFreeText}
                  error={errors[row.key]}
                  disabled={disabled}
                  onChange={(patch) => updateRow(row.key, patch)}
                  onRemove={() => setRows(rows.filter((entry) => entry.key !== row.key))}
                />
              ))}
            </Box>
          );
        })}
        {state.loaded && !state.failed && rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="companion-form-empty">
            {t('companions.form.empty')}
          </Typography>
        ) : null}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {COMPANION_KINDS.map((kind) => {
            const { Icon, paletteColor } = COMPANION_KIND_STYLES[kind];
            return (
              <Button
                key={kind}
                variant="text"
                size="small"
                color={paletteColor}
                startIcon={<Icon aria-hidden />}
                // Each label stays on one line; the buttons wrap below each other instead.
                sx={{ whiteSpace: 'nowrap' }}
                disabled={disabled || !state.loaded}
                onClick={() => setRows([...rows, emptyCompanionFormRow(kind)])}
              >
                {t(ADD_LABEL_KEYS[kind])}
              </Button>
            );
          })}
        </Box>
      </Stack>
    </Box>
  );
}

interface CompanionFormRowFieldsProps {
  row: CompanionFormRow;
  divided: boolean;
  options: CompanionFormOption[];
  allowFreeText: boolean;
  error?: 'required' | 'duplicate';
  disabled: boolean;
  onChange: (patch: Partial<CompanionFormRow>) => void;
  onRemove: () => void;
}

/**
 * One neighbour in a single row (two lines on a phone): neighbour, reason,
 * note, move to the other kind, delete.
 */
function CompanionFormRowFields({
  row,
  divided,
  options,
  allowFreeText,
  error,
  disabled,
  onChange,
  onRemove,
}: CompanionFormRowFieldsProps) {
  const { t } = useTranslation(['crops', 'common']);
  const errorText = error === 'required'
    ? t('companions.form.neighborRequired')
    : error === 'duplicate' ? t('companions.duplicate') : '';
  const sharedPairText = row.target?.type === 'crop' ? t('companions.form.sharedPair', { name: row.target.label }) : '';

  return (
    <Box
      data-testid="crop-companion-form-row"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: 1,
        py: 1,
        borderTop: divided ? 1 : 0,
        borderColor: 'divider',
      }}
    >
      {/* The row's value is a plain target; only the options carry their group. */}
      <Autocomplete<CompanionFormTarget & { group?: string }, false, false, boolean>
        freeSolo={allowFreeText}
        size="small"
        sx={{ flex: { xs: '1 1 0', sm: '1 1 200px' }, minWidth: 0, order: 0 }}
        options={options}
        value={row.target}
        disabled={disabled}
        groupBy={(option) => option.group ?? ''}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
        getOptionKey={(option) => (typeof option === 'string' ? option : companionTargetKey(option))}
        isOptionEqualToValue={(option, value) => (
          typeof value !== 'string' && companionTargetKey(option) === companionTargetKey(value)
        )}
        renderOption={({ key, ...optionProps }, option) => (
          <li key={key} {...optionProps}>
            {option.type === 'family' ? t('companions.form.wholeFamily', { family: option.label }) : option.label}
          </li>
        )}
        onChange={(_event, value) => {
          if (typeof value === 'string') {
            const text = value.trim();
            onChange({ target: text ? { type: 'text', text, label: text } : null });
            return;
          }
          onChange({ target: value });
        }}
        onInputChange={(_event, value, reason) => {
          // Typed text that matches no option is kept as a free-text neighbour.
          if (!allowFreeText || reason !== 'input') return;
          const text = value.trim();
          const matches = options.filter((option) => option.label.toLocaleLowerCase() === text.toLocaleLowerCase());
          // A crop wins over a family of the same name.
          const match = matches.find((option) => option.type !== 'family') ?? matches[0];
          onChange({ target: match ?? (text ? { type: 'text', text, label: text } : null) });
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            required
            label={t('companions.form.neighbor')}
            error={Boolean(errorText)}
            // The shared-pair note is a tooltip on the icon; a phone has no
            // hover, so it is spelled out below the field there.
            helperText={errorText || (sharedPairText ? (
              <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{sharedPairText}</Box>
            ) : undefined)}
            slotProps={{
              ...params.slotProps,
              input: {
                ...params.slotProps.input,
                startAdornment: sharedPairText ? (
                  <InputAdornment position="start" sx={{ ml: 0.5, mr: 0 }}>
                    <AppTooltip title={sharedPairText}>
                      <SyncAltIcon
                        fontSize="small"
                        color="action"
                        role="img"
                        aria-hidden={false}
                        aria-label={sharedPairText}
                        data-testid="companion-shared-pair"
                      />
                    </AppTooltip>
                  </InputAdornment>
                ) : params.slotProps.input.startAdornment,
              },
            }}
          />
        )}
      />
      <TextField
        select
        size="small"
        sx={{ flex: { xs: '1 1 0', sm: '0 1 200px' }, minWidth: 0, order: 3 }}
        label={t('companions.form.reason')}
        value={row.reason}
        disabled={disabled}
        onChange={(event) => onChange({ reason: event.target.value as CompanionReason })}
      >
        {COMPANION_REASONS.map((reason) => (
          <MenuItem key={reason} value={reason}>{t(companionReasonLabelKey(reason))}</MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        sx={{ flex: { xs: '1 1 0', sm: '1 1 120px' }, minWidth: 0, order: 4 }}
        label={t('companions.form.note')}
        value={row.note}
        disabled={disabled}
        slotProps={{ htmlInput: { maxLength: 500 } }}
        onChange={(event) => onChange({ note: event.target.value })}
      />
      {/* On a phone the actions sit beside the neighbour; reason and note share the second line. */}
      <Box aria-hidden sx={{ display: { xs: 'block', sm: 'none' }, flexBasis: '100%', height: 0, order: 2 }} />
      <Stack direction="row" sx={{ flexShrink: 0, order: { xs: 1, sm: 5 } }}>
        <AppTooltip title={t(MOVE_LABEL_KEYS[row.kind])}>
          <IconButton
            size="small"
            disabled={disabled}
            aria-label={t(MOVE_LABEL_KEYS[row.kind])}
            onClick={() => onChange({ kind: OTHER_KIND[row.kind] })}
          >
            <SwapVertIcon fontSize="small" />
          </IconButton>
        </AppTooltip>
        <AppTooltip title={t('companions.delete')}>
          <IconButton size="small" color="error" disabled={disabled} aria-label={t('companions.delete')} onClick={onRemove}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </AppTooltip>
      </Stack>
    </Box>
  );
}
