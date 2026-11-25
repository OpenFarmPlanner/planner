import { Link as RouterLink } from 'react-router';
import { Button } from '@mui/material';
import { useTranslation } from '../../i18n';
import { DetailSection } from '../layout/DetailPrimitives';
import { BedTaskList } from './BedTaskList';
import { useBedTasks } from './useBedTasks';

export function BedTaskSection({ bedId, seasonId }: { bedId: number; seasonId?: number }) {
  const { t } = useTranslation(['fields', 'dashboard']);
  const { tasksByBed, loading, failed, refresh } = useBedTasks('bed', bedId, seasonId, { includeCancelled: true });
  return (
    <DetailSection title={t('dashboard:board.title')}>
      <BedTaskList key={`${bedId}:${seasonId}`} tasks={tasksByBed.get(bedId) ?? []}
        loading={loading} failed={failed} refresh={refresh} />
      <Button component={RouterLink} to="/app/dashboard">{t('graphical.taskLayer.allTasks')}</Button>
    </DetailSection>
  );
}
