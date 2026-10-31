import AddIcon from '@mui/icons-material/Add';
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
import {
  COMPANION_KINDS,
  COMPANION_REASONS,
  companionReasonLabelKey,
  emptyCompanionFormRow,
  type CompanionFormRow,
  type CompanionFormTarget,
} from '../companions';
import type { CompanionFormRowsState } from '../useCompanionFormRows';

interface CompanionsSectionProps {
  state: CompanionFormRowsState;
  disabled?: boolean;
}

const GROUP_LABEL_KEYS: Record<CompanionFormTarget['type'], string> = {
  crop: 'companions.form.groupCrops',
  species: 'companions.form.groupCrops',
  family: 'companions.form.groupFamilies',
  text: 'companions.form.groupCrops',
};

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
 * docs/crop-companions.md#crop-form). A Sorte shows its Kultur's list read-only.
 */
export function CompanionsSection({ state, disabled = false }: CompanionsSectionProps) {
  const { t } = useTranslation(['crops', 'common']);
  const { mode, rows, setRows, options, allowFreeText, errors } = state;
  if (mode === 'hidden') return null;

  if (mode === 'readOnly') {
    return (
      <Box data-testid="crop-companions-form-section" sx={{ mt: 2 }}>
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
    <Box data-testid="crop-companions-form-section" sx={{ mt: 2 }}>
      <Typography variant="h6">{t('companions.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t(allowFreeText ? 'companions.form.description' : 'companions.form.libraryDescription')}
      </Typography>
      {state.failed ? <Alert severity="error" sx={{ mb: 1 }}>{t('companions.loadError')}</Alert> : null}
      <Stack spacing={1.5}>
        {COMPANION_KINDS.map((kind) => {
          const kindRows = rows.filter((row) => row.kind === kind);
          return (
            <Box key={kind} data-testid={`companion-form-group-${kind}`}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <CompanionKindHeading kind={kind} />
                <Button
                  size="small"
                  sx={{ flexShrink: 0, minWidth: 0, gap: 0.5 }}
                  disabled={disabled || !state.loaded}
                  aria-label={t(ADD_LABEL_KEYS[kind])}
                  onClick={() => setRows([...rows, emptyCompanionFormRow(kind)])}
                >
                  <AddIcon fontSize="small" />
                  {/* A phone keeps the heading on one line: the icon alone there. */}
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    {t('companions.form.add')}
                  </Box>
                </Button>
              </Stack>
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
      </Stack>
    </Box>
  );
}

interface CompanionFormRowFieldsProps {
  row: CompanionFormRow;
  divided: boolean;
  options: CompanionFormTarget[];
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
      <Autocomplete<CompanionFormTarget, false, false, boolean>
        freeSolo={allowFreeText}
        size="small"
        sx={{ flex: { xs: '1 1 0', sm: '1 1 200px' }, minWidth: 0, order: 0 }}
        options={options}
        value={row.target}
        disabled={disabled}
        groupBy={(option) => t(GROUP_LABEL_KEYS[option.type])}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
        isOptionEqualToValue={(option, value) => (
          typeof value !== 'string' && option.type === value.type && option.label === value.label
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
          const match = options.find((option) => option.label.toLocaleLowerCase() === text.toLocaleLowerCase());
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
