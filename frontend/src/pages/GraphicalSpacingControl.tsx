import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Popover, Stack, TextField, Typography } from '@mui/material';
import StraightenIcon from '@mui/icons-material/Straighten';
import type { Location, LocationPathSpacing } from '../api/types';
import { defaultLocationPathSpacing, getLocationPathSpacing } from '../components/hierarchy/utils/locationPathSpacing';
import { useTranslation } from '../i18n';
import { formatLocalizedNumberForInput, getActiveFormattingLocale, parseLocalizedNumber } from '../utils/numberLocalization';
import { ResponsiveToolbarAction, WORKSPACE_TOOLBAR_LABEL_QUERY } from '../components/buttons/ResponsiveToolbarAction';
import { useTouchOnly } from '../hooks/useTouchOnly';

export type OpenGraphicalSpacing = (anchor: HTMLButtonElement, keyboard: boolean) => void;

interface SpacingDraft {
  bed: string;
  parcel: string;
  snap: boolean;
}

const toDraft = (spacing: LocationPathSpacing, locale: string): SpacingDraft => ({
  bed: formatLocalizedNumberForInput(spacing.bed_path_spacing_cm, locale, { maximumSignificantDigits: 17 }),
  parcel: formatLocalizedNumberForInput(spacing.parcel_path_spacing_cm, locale, { maximumSignificantDigits: 17 }),
  snap: spacing.snap_to_path_spacing,
});

const isValidSpacing = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value >= 0;

export function GraphicalSpacingControl({
  location, onSave, compact, children,
}: {
  location: Location;
  onSave: (id: number, spacing: LocationPathSpacing) => Promise<void>;
  compact: boolean;
  children: (openSpacing: OpenGraphicalSpacing) => ReactNode;
}) {
  const { t } = useTranslation('fields');
  const locale = getActiveFormattingLocale();
  const id = useId();
  const touchOnly = useTouchOnly();
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [draft, setDraft] = useState<SpacingDraft>(() => toDraft(getLocationPathSpacing(location), locale));
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const bed = parseLocalizedNumber(draft.bed, locale);
  const parcel = parseLocalizedNumber(draft.parcel, locale);

  const open: OpenGraphicalSpacing = (trigger, keyboard) => {
    setDraft(toDraft(getLocationPathSpacing(location), locale));
    setSaveFailed(false);
    setOpenedByKeyboard(keyboard);
    setAnchor(trigger);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving || location.id === undefined || !isValidSpacing(bed) || !isValidSpacing(parcel)) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSave(location.id, {
        bed_path_spacing_cm: bed,
        parcel_path_spacing_cm: parcel,
        snap_to_path_spacing: draft.snap,
      });
      setAnchor(null);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {!compact && <ResponsiveToolbarAction
        variant="outlined"
        label={t('graphical.spacing.button')}
        labelQuery={WORKSPACE_TOOLBAR_LABEL_QUERY}
        icon={<StraightenIcon fontSize="small" />}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? id : undefined}
        onClick={event => open(event.currentTarget, event.detail === 0)}
      />}
      {children(open)}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => { if (!saving) setAnchor(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: {
          id, role: 'dialog', 'aria-modal': true, 'aria-labelledby': `${id}-title`,
          sx: { width: 380, maxWidth: 'calc(100% - 32px)', mt: 0.5 },
        } }}
      >
        <Stack component="form" spacing={1.5} sx={{ p: 2 }} onSubmit={event => { void submit(event); }}>
          <Typography id={`${id}-title`} component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t('graphical.spacing.title')}
          </Typography>
          {(['bed', 'parcel'] as const).map(kind => {
            const valid = isValidSpacing(kind === 'bed' ? bed : parcel);
            return (
              <TextField
                key={kind}
                autoFocus={kind === 'bed'}
                size="small"
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                label={t(`graphical.spacing.${kind}`)}
                value={draft[kind]}
                disabled={saving}
                error={!valid}
                helperText={!valid ? t('graphical.spacing.invalid') : undefined}
                onChange={event => {
                  const value = event.target.value;
                  setDraft(current => ({ ...current, [kind]: value }));
                }}
              />
            );
          })}
          <FormControlLabel
            control={<Checkbox checked={draft.snap} disabled={saving}
              onChange={(_, checked) => setDraft(current => ({ ...current, snap: checked }))} />}
            label={t('graphical.spacing.snap')}
          />
          {!touchOnly || openedByKeyboard ? (
            <Typography variant="body2" color="text.secondary">{t('graphical.spacing.bypass')}</Typography>
          ) : null}
          {saveFailed ? <Alert severity="error">{t('graphical.spacing.saveError')}</Alert> : null}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-end' }}>
            <Button disabled={saving} onClick={() => setDraft(toDraft(defaultLocationPathSpacing, locale))}>
              {t('graphical.spacing.reset')}
            </Button>
            <Button disabled={saving} onClick={() => setAnchor(null)}>{t('cancel')}</Button>
            <Button type="submit" variant="contained" disabled={saving || !isValidSpacing(bed) || !isValidSpacing(parcel)}>
              {t('graphical.spacing.apply')}
            </Button>
          </Box>
        </Stack>
      </Popover>
    </>
  );
}
