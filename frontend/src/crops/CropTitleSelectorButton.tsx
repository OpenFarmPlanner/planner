import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Box, Typography, type SxProps, type Theme } from '@mui/material';
import { alpha } from '@mui/material/styles';

interface CropTitleSelectorButtonProps {
  title: string;
  ariaLabel: string;
  onClick: () => void;
  titleSx?: SxProps<Theme>;
}

export function CropTitleSelectorButton({
  title,
  ariaLabel,
  onClick,
  titleSx,
}: CropTitleSelectorButtonProps) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        appearance: 'none',
        border: 'none',
        background: 'transparent',
        p: 0,
        m: 0,
        maxWidth: '100%',
        minWidth: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        cursor: 'pointer',
        color: 'inherit',
        textAlign: 'left',
        borderRadius: 0.75,
        '&:hover': { bgcolor: 'rgba(15, 23, 42, 0.04)' },
        '&:active': { bgcolor: 'rgba(15, 23, 42, 0.08)' },
        '&:focus-visible': {
          outline: (theme: Theme) => `2px solid ${alpha(theme.palette.primary.main, 0.28)}`,
          outlineOffset: 2,
        },
      }}
      aria-label={ariaLabel}
    >
      <Typography
        data-testid="crop-title-selector-label"
        component="span"
        noWrap
        sx={[
          {
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: '1.25rem',
            lineHeight: 1.2,
            fontWeight: 600,
          },
          ...(Array.isArray(titleSx) ? titleSx : [titleSx]),
        ]}
      >
        {title}
      </Typography>
      <ExpandMoreIcon data-testid="crop-title-selector-chevron" sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
    </Box>
  );
}
