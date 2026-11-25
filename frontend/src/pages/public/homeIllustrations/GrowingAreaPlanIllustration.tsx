import { Box, Stack, Typography } from '@mui/material';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';

interface GrowingAreaPlanIllustrationProps {
  /** Accessible description for the whole illustration. */
  ariaLabel: string;
  locationLabel: string;
  parcelLabel: string;
  bedLabels: string[];
  pathLabel: string;
  treeLabel: string;
}

const BED_SX: SxProps<Theme> = {
  borderRadius: 1,
  border: 1,
  borderColor: 'primary.main',
  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
  px: 0.5,
};

/**
 * Drawn illustration (not a screenshot, not a map) of the schematic growing
 * area plan: a location with a parcel, its beds separated by paths and one
 * individual tree drawn as a stem with its canopy. Purely decorative and inert.
 */
export default function GrowingAreaPlanIllustration({
  ariaLabel, locationLabel, parcelLabel, bedLabels, pathLabel, treeLabel,
}: GrowingAreaPlanIllustrationProps) {
  return (
    <Box role="img" aria-label={ariaLabel} sx={{ width: '100%' }}>
      <Box
        aria-hidden
        sx={{
          width: '100%',
          maxWidth: 500,
          mx: 'auto',
          p: 2.5,
          borderRadius: 4,
          bgcolor: 'surface.surfaceHoverBackground',
        }}
      >
        <Stack
          spacing={1.5}
          sx={{
            p: 2,
            borderRadius: 2,
            border: 1,
            borderColor: 'info.main',
            bgcolor: (theme) => alpha(theme.palette.info.main, 0.08),
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'info.dark' }}>{locationLabel}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)', gap: 2, alignItems: 'center' }}>
            <Stack
              spacing={1}
              sx={{ p: 1.5, borderRadius: 2, border: 2, borderColor: 'primary.main', bgcolor: 'background.paper' }}
            >
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.dark' }}>{parcelLabel}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${bedLabels.length}, minmax(0, 1fr))`, gap: 1.5, height: 120 }}>
                {bedLabels.map((label) => (
                  <Box key={label} sx={BED_SX}>
                    <Typography variant="caption" sx={{ fontWeight: 600, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                      {label}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 24, borderTop: 2, borderStyle: 'dashed', borderColor: 'text.secondary' }} />
                <Typography variant="caption" color="text.secondary">{pathLabel}</Typography>
              </Stack>
            </Stack>
            <Stack spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Box
                sx={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  border: 2,
                  borderStyle: 'dashed',
                  borderColor: 'success.main',
                  bgcolor: (theme) => alpha(theme.palette.success.main, 0.12),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'success.dark' }} />
              </Box>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center', overflowWrap: 'anywhere' }}>
                {treeLabel}
              </Typography>
            </Stack>
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
