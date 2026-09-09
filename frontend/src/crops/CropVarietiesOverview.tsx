import type { ReactNode } from 'react';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Box, Stack, Typography } from '@mui/material';
import type { Crop } from '../api/types';
import { AppTooltip } from '../components/AppTooltip';
import { useTranslation } from '../i18n';
import { VarietiesComparisonTable } from './VarietiesComparisonTable';

interface VarietyOverviewRow {
  crop: Crop;
  label: string;
}

interface CropVarietiesOverviewProps {
  varieties: VarietyOverviewRow[];
  cropCrop: Crop;
  onSelect: (crop: Crop) => void;
  action?: ReactNode;
}

export function CropVarietiesOverview({
  varieties,
  cropCrop,
  onSelect,
  action,
}: CropVarietiesOverviewProps) {
  const { t } = useTranslation('crops');

  return (
    <Box sx={{ mb: 3, p: { xs: 1.25, sm: 2 }, border: '1px solid', borderColor: 'surface.surfaceBorder', borderRadius: 2 }}>
      <Stack
        direction="row"
        sx={{
          mb: varieties.length > 0 ? 1.5 : 0,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.5}>
          <Typography variant="h6">
            {t('hierarchy.varietiesTitle')}
          </Typography>
          <AppTooltip title={t('hierarchy.varietiesColumnsTooltip')}>
            <Box component="span" tabIndex={0} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'default' }}>
              <InfoOutlinedIcon fontSize="small" />
            </Box>
          </AppTooltip>
        </Stack>
        {action}
      </Stack>
      {varieties.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('hierarchy.varietiesEmpty')}
        </Typography>
      ) : (
        <VarietiesComparisonTable
          varieties={varieties}
          cropCrop={cropCrop}
          onSelect={onSelect}
        />
      )}
    </Box>
  );
}
