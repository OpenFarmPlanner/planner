import { useId } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useTranslation } from '../i18n';
import type { PlantHealthEntry } from '../crop-library/plant-health/types';
import { SourceLinks } from '../crop-library/plant-health/SourceLinks';
import LoadRetryButton from '../components/LoadRetryButton';

export function PlantHealthRelationshipsDialog({ entry, name, loading, error, onRetry, onClose }: {
  entry?: PlantHealthEntry; name: string; loading: boolean; error: boolean;
  onRetry: () => void; onClose: () => void;
}) {
  const { t } = useTranslation(['crops', 'common']);
  const titleId = useId();
  const fullscreen = useMediaQuery(useTheme().breakpoints.down('md'));
  const specific = entry?.status === 'published' && entry.has_specific_identity
    && (entry.kind === 'pest' || entry.kind === 'pathogen');
  const hosts = specific ? entry.hosts.filter(host => host.is_active && host.is_confirmed
    && host.species_status === 'published' && host.sources.length > 0) : [];
  return <Dialog open fullWidth maxWidth="sm" fullScreen={fullscreen} onClose={onClose} aria-labelledby={titleId}>
    <DialogTitle id={titleId}>{t('crops:plantHealth.relationshipsTitle')}</DialogTitle>
    <DialogContent dividers><Stack spacing={2}>
      <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{entry?.display_name ?? name}</Typography>
      <Alert severity="info">{t('crops:plantHealth.relationshipsHint')}</Alert>
      {loading ? <CircularProgress size={24} /> : error ? <Alert severity="error"
        action={<LoadRetryButton onClick={onRetry} />}>{t('crops:plantHealth.relationshipsError')}</Alert>
        : !entry ? <Alert severity="info">{t('crops:plantHealth.unavailable')}</Alert>
          : !specific ? <Alert severity="info">{t('crops:plantHealth.broadRelationshipHint')}</Alert>
            : <>
              {entry.scientific_name ? <Typography sx={{ fontStyle: 'italic', overflowWrap: 'anywhere' }}>{entry.scientific_name}</Typography> : null}
              {!hosts.length ? <Typography>{t('crops:plantHealth.noConfirmedHosts')}</Typography> : null}
              {hosts.map(host => <Paper key={host.id} variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
                <Stack spacing={1}>
                  <Typography sx={{ fontWeight: 'bold', overflowWrap: 'anywhere' }}>{host.species_name}</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{t(host.variety_name ? 'crops:plantHealth.qualifiedVariety' : 'crops:plantHealth.speciesHost', { name: host.variety_name })}</Typography>
                  {host.qualification ? <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{host.qualification}</Typography> : null}
                  <SourceLinks sources={host.sources} />
                </Stack>
              </Paper>)}
            </>}
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose}>{t('common:actions.close')}</Button></DialogActions>
  </Dialog>;
}
