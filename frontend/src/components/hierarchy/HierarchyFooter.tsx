/**
 * Custom footer for hierarchy grid
 */

import { Box, IconButton, Typography } from '@mui/material';
import { useTranslation } from '../../i18n';
import { dataGridFooterSx } from '../data-grid/styles';
import type { Location } from '../../api/api';

interface HierarchyFooterProps {
  locations: Location[];
  onAddField: (locationId?: number) => void;
}

export function HierarchyFooter({ locations, onAddField }: HierarchyFooterProps) {
  const { t } = useTranslation('hierarchy');
  const hasMultipleLocations = locations.length > 1;
  
  return (
    <Box sx={{ 
      ...dataGridFooterSx,
      alignItems: 'center',
      gap: 2,
    }}>
      {!hasMultipleLocations && locations.length > 0 && (
        <IconButton
          onClick={() => onAddField(locations[0]?.id)}
          color="primary"
          size="small"
          aria-label={t('addField')}
        >
          <Typography component="span" variant="body2" sx={{ mr: 0.5 }}>{t('addField')}</Typography>
        </IconButton>
      )}
      <Typography component="span" variant="body2" color="text.secondary">
        {hasMultipleLocations 
          ? t('footer.multipleLocations')
          : t('footer.singleLocation')}
      </Typography>
    </Box>
  );
}
