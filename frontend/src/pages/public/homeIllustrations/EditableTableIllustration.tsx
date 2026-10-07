import { Box, Stack, Typography } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import GrassIcon from '@mui/icons-material/Grass';
import AgricultureIcon from '@mui/icons-material/Agriculture';

interface TableRow {
  crop: string;
  fieldBed: string;
  plantingDate: string;
  areaM2: string;
  plantsCount: string;
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
  columns: { crop: string; fieldBed: string; plantingDate: string; areaM2: string; plantsCount: string };
  rows: TableRow[];
  linkedCaption: string;
  cards: { title: string; detail: string }[];
}

// Last two columns (area, plant count) are numeric and right-aligned.
const RIGHT_ALIGNED_COLUMN_INDICES = new Set([3, 4]);
// The planting-date column, highlighted on the row marked `editing`.
const EDITABLE_COLUMN_INDEX = 2;

function rowCells(row: TableRow): string[] {
  return [row.crop, row.fieldBed, row.plantingDate, row.areaM2, row.plantsCount];
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
  const columnLabels = [columns.crop, columns.fieldBed, columns.plantingDate, columns.areaM2, columns.plantsCount];

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
          <Box sx={{ minWidth: 560, display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 1fr 0.7fr 0.8fr' }}>
            {columnLabels.map((label, columnIndex) => (
              <Box
                key={label}
                sx={{
                  px: 1.5,
                  py: 1,
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  color: 'text.secondary',
                  textAlign: RIGHT_ALIGNED_COLUMN_INDICES.has(columnIndex) ? 'right' : 'left',
                  borderBottom: 2,
                  borderColor: 'divider',
                }}
              >
                {label}
              </Box>
            ))}
            {rows.map((row) => (
              <Box key={row.crop} sx={{ display: 'contents' }}>
                {rowCells(row).map((value, cellIndex) => {
                  const isEditingCell = row.editing && cellIndex === EDITABLE_COLUMN_INDEX;
                  return (
                    <Box
                      key={`${row.crop}-${cellIndex}`}
                      sx={{
                        px: 1.5,
                        py: 1.2,
                        fontSize: '0.85rem',
                        position: 'relative',
                        textAlign: RIGHT_ALIGNED_COLUMN_INDICES.has(cellIndex) ? 'right' : 'left',
                        bgcolor: isEditingCell ? 'surface.surfaceHoverBackground' : 'transparent',
                        border: isEditingCell ? 2 : 0,
                        borderBottom: isEditingCell ? 2 : 1,
                        borderColor: isEditingCell ? 'primary.main' : 'divider',
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
