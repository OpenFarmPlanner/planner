import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import { Chip, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface RequirementChecklistItem {
  label: string;
  satisfied: boolean;
  satisfiedLabel?: string;
  missingLabel?: string;
}

interface RequirementChecklistProps {
  items: RequirementChecklistItem[];
}

export default function RequirementChecklist({ items }: RequirementChecklistProps) {
  const { t } = useTranslation('common');

  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: 'flex-start',
      flexWrap: "wrap", }}  >
      {items.map((item) => (
        <Stack key={item.label} direction="row" spacing={1} sx={{ alignItems: "center", }} >
          <Chip
            size="small"
            color={item.satisfied ? 'success' : 'default'}
            variant={item.satisfied ? 'filled' : 'outlined'}
            icon={item.satisfied ? <CheckCircleOutlineIcon /> : <ErrorOutlineIcon />}
            label={item.satisfied
              ? (item.satisfiedLabel ?? t('requirements.satisfied', { label: item.label }))
              : (item.missingLabel ?? t('requirements.missing', { label: item.label }))}
            sx={item.satisfied
              ? undefined
              : {
                color: 'text.secondary',
                borderColor: 'divider',
                '& .MuiChip-icon': {
                  color: 'text.secondary',
                },
              }}
          />
        </Stack>
      ))}
    </Stack>
  );
}
