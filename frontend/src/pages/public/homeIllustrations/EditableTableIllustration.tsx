import { Box, Stack, Typography } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import GrassIcon from '@mui/icons-material/Grass';
import AgricultureIcon from '@mui/icons-material/Agriculture';

interface TableRow {
  crop: string;
  bed: string;
  date: string;
  quantity: string;
  editing?: boolean;
}

interface LinkedCard {
  icon: React.ReactNode;
  title: string;
  detail: string;
}

interface EditableTableIllustrationProps {
  /** Accessible description for the whole illustration group. */
  ariaLabel: string;
  columns: { crop: string; bed: string; date: string; quantity: string };
  rows: TableRow[];
  linkedCaption: string;
  cards: { title: string; detail: string }[];
}

/**
 * Drawn illustration (not a screenshot) of the inline-editable planting-plan
 * table and the views that recalculate from it. Kept as its own component so
 * it can later be swapped for a short video without touching the section
 * around it.
 */
export default function EditableTableIllustration({
  ariaLabel,
  columns,
  rows,
  linkedCaption,
  cards,
}: EditableTableIllustrationProps) {
  const cardIcons = [<CalendarMonthIcon key="calendar" />, <GrassIcon key="sowing" />, <AgricultureIcon key="yield" />];
  const linkedCards: LinkedCard[] = cards.map((card, index) => ({
    icon: cardIcons[index],
    title: card.title,
    detail: card.detail,
  }));

  return (
    <Box role="img" aria-label={ariaLabel} sx={{ width: '100%' }}>
      <Stack aria-hidden spacing={2.5} sx={{ width: '100%' }}>
        <Box
          sx={{
            width: '100%',
            overflowX: 'auto',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ minWidth: 420, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {[columns.crop, columns.bed, columns.date, columns.quantity].map((label) => (
              <Box
                key={label}
                sx={{
                  px: 1.5,
                  py: 1,
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  color: 'text.secondary',
                  borderBottom: 2,
                  borderColor: 'divider',
                }}
              >
                {label}
              </Box>
            ))}
            {rows.map((row) => (
              <Box key={row.crop} sx={{ display: 'contents' }}>
                {[row.crop, row.bed, row.date, row.quantity].map((value, cellIndex) => {
                  const isEditingCell = row.editing && cellIndex === 2;
                  return (
                    <Box
                      key={`${row.crop}-${cellIndex}`}
                      sx={{
                        px: 1.5,
                        py: 1.2,
                        fontSize: '0.85rem',
                        borderBottom: 1,
                        borderColor: 'divider',
                        position: 'relative',
                        bgcolor: isEditingCell ? 'surface.surfaceHoverBackground' : 'transparent',
                        border: isEditingCell ? 2 : 0,
                        borderColor: isEditingCell ? 'primary.main' : 'transparent',
                        boxSizing: 'border-box',
                      }}
                    >
                      {value}
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Box>

        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
            <LinkIcon fontSize="small" color="primary" />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {linkedCaption}
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            {linkedCards.map((card) => (
              <Stack
                key={card.title}
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                  flex: 1,
                  p: 1.25,
                  borderRadius: 2,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'surface.surfaceSubtleBackground',
                }}
              >
                <Box sx={{ color: 'primary.main', display: 'flex' }}>{card.icon}</Box>
                <Stack spacing={0}>
                  <Typography variant="caption" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                    {card.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                    {card.detail}
                  </Typography>
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Stack>
    </Box>
  );
}
