import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';

import type { CompanionKind, CompanionReason } from '../../api/types';
import { AppTooltip } from '../../components/AppTooltip';
import { formRowSx, smallFieldSx, wideFieldSx } from '../../components/forms/formLayout';
import { useTranslation } from '../../i18n';
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

const KIND_LABEL_KEYS: Record<CompanionKind, string> = {
  good: 'companions.form.kindGood',
  bad: 'companions.form.kindBad',
};

const GROUP_LABEL_KEYS: Record<CompanionFormTarget['type'], string> = {
  crop: 'companions.form.groupCrops',
  species: 'companions.form.groupCrops',
  family: 'companions.form.groupFamilies',
  text: 'companions.form.groupCrops',
};

/**
 * "Mischkultur" in the crop form: the Kultur's good and bad neighbours, saved
 * with the form (see docs/crop-companions.md#crop-form). A Sorte shows its
 * Kultur's list read-only.
 */
export function CompanionsSection({ state, disabled = false }: CompanionsSectionProps) {
  const { t } = useTranslation(['crops', 'common']);
  const { mode, rows, setRows, options, allowFreeText, errors } = state;
  if (mode === 'hidden') return null;

  const updateRow = (key: string, patch: Partial<CompanionFormRow>) => {
    setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };
  const removeRow = (key: string) => setRows(rows.filter((row) => row.key !== key));
  const addRow = () => setRows([...rows, emptyCompanionFormRow()]);

  const errorText = (key: string): string => {
    if (errors[key] === 'required') return t('companions.form.neighborRequired');
    if (errors[key] === 'duplicate') return t('companions.duplicate');
    return '';
  };
  const helperText = (row: CompanionFormRow): string => {
    if (row.target?.type === 'crop') return t('companions.form.sharedPair', { name: row.target.label });
    return t(allowFreeText ? 'companions.form.neighborHelper' : 'companions.form.libraryNeighborHelper');
  };

  if (mode === 'readOnly') {
    return (
      <Box data-testid="crop-companions-form-section" sx={{ mt: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>{t('companions.title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('companions.form.varietyReadOnly', { name: state.kulturName })}
        </Typography>
        {rows.length > 0 ? (
          <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
            {rows.map((row) => (
              <Typography component="li" variant="body2" key={row.key}>
                {`${t(KIND_LABEL_KEYS[row.kind])}: ${row.target?.label ?? ''}`}
              </Typography>
            ))}
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box data-testid="crop-companions-form-section" sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
      <Typography variant="h6">{t('companions.title')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('companions.form.description')}</Typography>
      {state.failed ? <Alert severity="error">{t('companions.loadError')}</Alert> : null}
      {rows.map((row) => {
        const rowError = errorText(row.key);
        return (
          <Box
            key={row.key}
            data-testid="crop-companion-form-row"
            sx={{ ...formRowSx, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}
          >
            <TextField
              select
              sx={smallFieldSx}
              label={t('companions.form.kind')}
              value={row.kind}
              disabled={disabled}
              onChange={(event) => updateRow(row.key, { kind: event.target.value as CompanionKind })}
            >
              {COMPANION_KINDS.map((kind) => (
                <MenuItem key={kind} value={kind}>{t(KIND_LABEL_KEYS[kind])}</MenuItem>
              ))}
            </TextField>
            <Autocomplete<CompanionFormTarget, false, false, boolean>
              freeSolo={allowFreeText}
              sx={wideFieldSx}
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
                  updateRow(row.key, { target: text ? { type: 'text', text, label: text } : null });
                  return;
                }
                updateRow(row.key, { target: value });
              }}
              onInputChange={(_event, value, reason) => {
                // Typed text that matches no option is kept as a free-text neighbour.
                if (!allowFreeText || reason !== 'input') return;
                const text = value.trim();
                const match = options.find((option) => option.label.toLocaleLowerCase() === text.toLocaleLowerCase());
                updateRow(row.key, { target: match ?? (text ? { type: 'text', text, label: text } : null) });
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  required
                  label={t('companions.form.neighbor')}
                  error={Boolean(rowError)}
                  helperText={rowError || helperText(row)}
                />
              )}
            />
            <TextField
              select
              sx={smallFieldSx}
              label={t('companions.form.reason')}
              value={row.reason}
              disabled={disabled}
              onChange={(event) => updateRow(row.key, { reason: event.target.value as CompanionReason })}
            >
              {COMPANION_REASONS.map((reason) => (
                <MenuItem key={reason} value={reason}>{t(companionReasonLabelKey(reason))}</MenuItem>
              ))}
            </TextField>
            <TextField
              sx={wideFieldSx}
              label={t('companions.form.note')}
              value={row.note}
              disabled={disabled}
              slotProps={{ htmlInput: { maxLength: 500 } }}
              onChange={(event) => updateRow(row.key, { note: event.target.value })}
            />
            <AppTooltip title={t('companions.delete')}>
              <IconButton
                color="error"
                disabled={disabled}
                aria-label={t('companions.delete')}
                onClick={() => removeRow(row.key)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </AppTooltip>
          </Box>
        );
      })}
      <Box>
        <Button variant="outlined" startIcon={<AddIcon />} disabled={disabled || !state.loaded} onClick={addRow}>
          {t('companions.add')}
        </Button>
      </Box>
    </Box>
  );
}
