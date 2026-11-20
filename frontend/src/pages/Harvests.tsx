import { CircularProgress, Stack } from '@mui/material';
import { useOutletContext } from 'react-router';
import PageContainer from '../components/layout/PageContainer';
import PageSurface from '../components/layout/PageSurface';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import { HarvestRecords } from '../harvests/HarvestRecords';
import { initialSeasonRecordDate } from '../seasons/formatSeasonDate';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import { useTranslation } from '../i18n';
import type { RootLayoutOutletContext } from '../navigation/topbarTypes';

export default function HarvestsPage() {
  const { t } = useTranslation('harvests');
  const { activeProjectId, missingProjectReason } = useProjectRequirement();
  const outlet = useOutletContext<RootLayoutOutletContext | null>();
  const activeSeason = outlet?.activeSeason;
  const seasonLoaded = outlet?.activeSeasonLoaded ?? true;
  const scope = `${activeProjectId ?? ''}:${activeSeason?.id ?? ''}`;
  return (
    <PageContainer variant="workspacePage">
      <PageSurface variant="fullWorkspace">
        {missingProjectReason ? <ProjectRequiredState reason={missingProjectReason} /> : (
          <Stack spacing={2} sx={{ maxWidth: 900 }}>
            {activeProjectId !== null && (seasonLoaded
              ? <HarvestRecords key={scope} scope={scope} initialDate={initialSeasonRecordDate(activeSeason)} />
              : <CircularProgress size={24} aria-label={t('loading')} />)}
          </Stack>
        )}
      </PageSurface>
    </PageContainer>
  );
}
