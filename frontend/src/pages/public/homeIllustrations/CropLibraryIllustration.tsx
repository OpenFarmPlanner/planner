import { Box, Chip, Stack, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import GrassIcon from '@mui/icons-material/Grass';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import type { SxProps, Theme } from '@mui/material/styles';

type ArrowDirection = 'up' | 'down';
type ArrowColor = 'primary' | 'info';

interface FlowArrowSpec {
  direction: ArrowDirection;
  dashed: boolean;
  color: ArrowColor;
  label: string;
}

interface CropLibraryIllustrationProps {
  /** Accessible description for the whole illustration group. */
  ariaLabel: string;
  libraryTitle: string;
  librarySubtitle: string;
  arrows: {
    share: string;
    shareUpdate: string;
    import: string;
    pullUpdate: string;
  };
  yourCropsTitle: string;
  cropChips: string[];
}

const ARROW_LINE_HEIGHT = 32;

function FlowArrow({ direction, dashed, color, label }: FlowArrowSpec) {
  const Icon = direction === 'up' ? KeyboardArrowUpIcon : KeyboardArrowDownIcon;
  const lineColor = `${color}.main` as const;
  const labelColor = `${color}.dark` as const;

  return (
    <Stack spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      {direction === 'up' ? <Icon sx={{ color: lineColor }} /> : null}
      <Box
        sx={{
          width: 0,
          height: ARROW_LINE_HEIGHT,
          borderLeft: 2,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: lineColor,
        }}
      />
      {direction === 'down' ? <Icon sx={{ color: lineColor }} /> : null}
      <Typography
        variant="caption"
        sx={{
          fontWeight: 700,
          lineHeight: 1.2,
          textAlign: 'center',
          color: labelColor,
        }}
      >
        {label}
      </Typography>
    </Stack>
  );
}

/**
 * Drawn illustration (not a screenshot) of how crop data flows both ways
 * between a project and the shared crop library: sharing a crop or an
 * improvement up, importing a crop or pulling an update down. Purely
 * decorative and inert.
 */
export default function CropLibraryIllustration({
  ariaLabel,
  libraryTitle,
  librarySubtitle,
  arrows,
  yourCropsTitle,
  cropChips,
}: CropLibraryIllustrationProps) {
  const arrowSpecs: FlowArrowSpec[] = [
    { direction: 'up', dashed: false, color: 'primary', label: arrows.share },
    { direction: 'up', dashed: true, color: 'primary', label: arrows.shareUpdate },
    { direction: 'down', dashed: false, color: 'info', label: arrows.import },
    { direction: 'down', dashed: true, color: 'info', label: arrows.pullUpdate },
  ];

  const libraryCardSx: SxProps<Theme> = {
    position: 'relative',
    p: 2,
    borderRadius: 2,
    bgcolor: 'background.paper',
    border: 2,
    borderColor: 'primary.main',
  };

  return (
    <Box role="img" aria-label={ariaLabel} sx={{ width: '100%' }}>
      <Stack
        aria-hidden
        spacing={2.5}
        sx={{
          width: '100%',
          maxWidth: 500,
          mx: 'auto',
          p: 2.5,
          borderRadius: 4,
          bgcolor: 'surface.surfaceHoverBackground',
        }}
      >
        <Box sx={{ position: 'relative' }}>
          {/* Two slightly offset light-green layers peeking out behind the card, to read as a stack of many library entries. */}
          <Box
            sx={{
              position: 'absolute',
              top: 10,
              left: 10,
              width: '100%',
              height: '100%',
              borderRadius: 2,
              bgcolor: 'surface.surfaceHoverBackground',
              border: 1,
              borderColor: 'primary.light',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              top: 5,
              left: 5,
              width: '100%',
              height: '100%',
              borderRadius: 2,
              bgcolor: 'surface.surfaceHoverBackground',
              border: 1,
              borderColor: 'primary.light',
            }}
          />
          <Stack direction="row" spacing={1.5} sx={libraryCardSx}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <MenuBookIcon />
            </Box>
            <Stack spacing={0}>
              <Typography sx={{ fontWeight: 700 }}>{libraryTitle}</Typography>
              <Typography variant="caption" color="text.secondary">
                {librarySubtitle}
              </Typography>
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
          {arrowSpecs.map((arrow) => (
            <FlowArrow key={arrow.label} {...arrow} />
          ))}
        </Box>

        <Stack
          spacing={1.25}
          sx={{
            p: 2,
            borderRadius: 2,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: 1,
                bgcolor: 'surface.surfaceHoverBackground',
                color: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <GrassIcon fontSize="small" />
            </Box>
            <Typography sx={{ fontWeight: 700 }}>{yourCropsTitle}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {cropChips.map((chip) => (
              <Chip key={chip} label={chip} size="small" variant="outlined" />
            ))}
          </Stack>
        </Stack>
      </Stack>
    </Box>
  );
}
