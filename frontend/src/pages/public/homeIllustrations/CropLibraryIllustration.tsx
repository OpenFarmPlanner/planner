import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';

interface CropLibraryIllustrationEntry {
  name: string;
  detail: string;
}

interface CropLibraryIllustrationProps {
  /** Accessible description for the whole illustration group. */
  ariaLabel: string;
  headerLabel: string;
  importLabel: string;
  upToDateLabel: string;
  publishLabel: string;
  entries: {
    import: CropLibraryIllustrationEntry;
    upToDate: CropLibraryIllustrationEntry;
    publish: CropLibraryIllustrationEntry;
  };
}

interface EntryCardProps {
  entry: CropLibraryIllustrationEntry;
  dashed?: boolean;
  action: React.ReactNode;
}

function EntryCard({ entry, dashed, action }: EntryCardProps) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      sx={{
        alignItems: { xs: 'flex-start', sm: 'center' },
        justifyContent: 'space-between',
        p: 1.5,
        borderRadius: 2,
        bgcolor: 'background.paper',
        border: dashed ? 2 : 1,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: dashed ? 'primary.light' : 'divider',
      }}
    >
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600 }}>{entry.name}</Typography>
        <Typography variant="body2" color="text.secondary">
          {entry.detail}
        </Typography>
      </Stack>
      <Box sx={{ flexShrink: 0 }}>{action}</Box>
    </Stack>
  );
}

/**
 * Drawn illustration (not a screenshot) of the crop library: three example
 * library entries rendered with the same MUI controls, variants, colours and
 * icons as the real crop-library import button and `CropLibraryActionButton`
 * states, but inert (not focusable, not clickable) since this is purely
 * decorative content.
 */
export default function CropLibraryIllustration({
  ariaLabel,
  headerLabel,
  importLabel,
  upToDateLabel,
  publishLabel,
  entries,
}: CropLibraryIllustrationProps) {
  return (
    <Box role="img" aria-label={ariaLabel} sx={{ width: '100%' }}>
      <Stack
        aria-hidden
        spacing={2}
        sx={{
          width: '100%',
          maxWidth: 480,
          mx: 'auto',
          p: 2.5,
          borderRadius: 4,
          bgcolor: 'surface.surfaceHoverBackground',
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 1,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <MenuBookIcon fontSize="small" />
          </Box>
          <Typography sx={{ fontWeight: 700 }}>{headerLabel}</Typography>
        </Stack>

        <Stack spacing={1.25}>
          <EntryCard
            entry={entries.import}
            action={
              <Button
                variant="contained"
                size="small"
                tabIndex={-1}
                startIcon={<DownloadOutlinedIcon fontSize="small" />}
                sx={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
              >
                {importLabel}
              </Button>
            }
          />
          <EntryCard
            entry={entries.upToDate}
            action={
              <Chip
                size="small"
                variant="outlined"
                color="info"
                icon={<SyncOutlinedIcon fontSize="small" />}
                label={upToDateLabel}
                tabIndex={-1}
                sx={{ pointerEvents: 'none' }}
              />
            }
          />
          <EntryCard
            entry={entries.publish}
            dashed
            action={
              <Button
                variant="outlined"
                color="primary"
                size="small"
                tabIndex={-1}
                startIcon={<ArrowUpwardIcon fontSize="small" />}
                sx={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
              >
                {publishLabel}
              </Button>
            }
          />
        </Stack>
      </Stack>
    </Box>
  );
}
