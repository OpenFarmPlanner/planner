import { Box, Button, Chip, Link, Paper, Stack, Typography } from '@mui/material';
import { useTranslation } from '../../i18n';
import type { PlantHealthEntry, PlantHealthHost, PlantHealthSource } from './types';

function SourceLinks({ sources }: { sources: PlantHealthSource[] }) {
  return <Stack spacing={0.5}>{sources.map((source, index) => <Box key={index}>
    <Link href={source.url} target="_blank" rel="noopener noreferrer" sx={{ overflowWrap: 'anywhere' }}>{source.title || source.url}</Link>
    {source.evidence ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source.evidence}</Typography> : null}
  </Box>)}</Stack>;
}

export function EntryCard({ entry, disabled, onEdit, onReview, onReject, onArchive, onReopen, onHistory, onHost, onArchiveHost }: {
  entry: PlantHealthEntry; disabled: boolean; onEdit: () => void; onReview: () => void; onReject: () => void;
  onArchive: () => void; onReopen: () => void; onHistory: () => void; onHost: (host?: PlantHealthHost) => void; onArchiveHost: (host: PlantHealthHost) => void;
}) {
  const { t } = useTranslation(['crops', 'common']);
  return <Paper component="article" aria-label={entry.display_name} variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
    <Stack spacing={1.5}>
      <Typography component="h3" variant="h6" sx={{ overflowWrap: 'anywhere' }}>{entry.display_name}</Typography>
      {entry.scientific_name ? <Typography sx={{ fontStyle: 'italic', overflowWrap: 'anywhere' }}>{entry.scientific_name}</Typography> : null}
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Chip size="small" label={t(`crops:plantHealthCatalogue.kinds.${entry.kind}`)} />
        <Chip size="small" label={t(`crops:plantHealthCatalogue.statuses.${entry.status}`)} color={entry.status === 'published' ? 'success' : 'default'} />
      </Stack>
      <SourceLinks sources={entry.sources} />
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
        {entry.status !== 'archived' ? <Button size="small" disabled={disabled} onClick={onEdit}>{t('common:actions.edit')}</Button> : null}
        {entry.status === 'proposed' ? <>
          <Button size="small" variant="contained" disabled={disabled} onClick={onReview}>{t('crops:plantHealthCatalogue.review')}</Button>
          <Button size="small" disabled={disabled} onClick={onReject}>{t('crops:plantHealthCatalogue.reject')}</Button>
        </> : null}
        {entry.status !== 'archived' ? <Button size="small" disabled={disabled} onClick={onArchive}>{t('crops:plantHealthCatalogue.archive')}</Button> : null}
        {entry.status === 'archived' || entry.status === 'rejected' ? <Button size="small" disabled={disabled} onClick={onReopen}>{t('crops:plantHealthCatalogue.reopen')}</Button> : null}
        <Button size="small" disabled={disabled} onClick={onHistory}>{t('crops:plantHealthCatalogue.history')}</Button>
      </Stack>
      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{t('crops:plantHealthCatalogue.hosts')}</Typography>
      {!entry.hosts.length ? <Typography variant="body2" color="text.secondary">{t('crops:plantHealthCatalogue.noHosts')}</Typography> : null}
      {entry.hosts.map(host => <Box key={host.id} sx={{ pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
        <Stack spacing={1}>
          <Typography sx={{ fontWeight: 'bold', overflowWrap: 'anywhere' }}>{host.species_name}{host.variety_name ? ` · ${host.variety_name}` : ''}</Typography>
          <Chip size="small" sx={{ alignSelf: 'flex-start', maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
            label={t(`crops:plantHealthCatalogue.${host.is_confirmed ? 'confirmed' : 'unconfirmed'}`)} />
          {host.qualification ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{host.qualification}</Typography> : null}
          <SourceLinks sources={host.sources} />
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
            {entry.status === 'published' ? <Button size="small" disabled={disabled} onClick={() => onHost(host)}>{t('crops:plantHealthCatalogue.editHost')}</Button> : null}
            <Button size="small" disabled={disabled} onClick={() => onArchiveHost(host)}>{t('crops:plantHealthCatalogue.archiveHost')}</Button>
          </Stack>
        </Stack>
      </Box>)}
      {entry.status === 'published' ? <Button variant="outlined" disabled={disabled} sx={{ alignSelf: 'flex-start' }} onClick={() => onHost()}>{t('crops:plantHealthCatalogue.addHost')}</Button> : null}
    </Stack>
  </Paper>;
}
