import { Box, Typography } from '@mui/material';
import { useTranslation } from '../i18n';

interface SeasonCopyTotalsProps {
  /** Plans already in the target season; the copy never changes them. */
  existing: number;
  /** New plans the confirmation creates, after the conflict treatment. */
  added: number;
  withoutBed: number;
  skippedConflicts: number;
}

/** What an additive copy into an existing season results in, from the effective preview. */
export function SeasonCopyTotals({ existing, added, withoutBed, skippedConflicts }: SeasonCopyTotalsProps) {
  const { t } = useTranslation('navigation');
  const key = (name: string) => `seasonSwitcher.copyDialog.totals.${name}`;
  const details = [
    withoutBed > 0 ? t(key('withoutBed'), { count: withoutBed }) : null,
    skippedConflicts > 0 ? t(key('skippedConflicts'), { count: skippedConflicts }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <Box data-testid="season-copy-totals">
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {t(key('result'), { existing, added, count: existing + added })}
      </Typography>
      {details && <Typography variant="body2" color="text.secondary">{details}</Typography>}
      {existing > 0 && (
        <Typography variant="body2" color="text.secondary">{t(key('existingKept'), { count: existing })}</Typography>
      )}
    </Box>
  );
}
