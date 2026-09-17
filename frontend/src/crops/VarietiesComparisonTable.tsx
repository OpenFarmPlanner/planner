import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import type { Crop } from '../api/types';
import { useTranslation } from '../i18n';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';
import TableSurface from '../components/layout/TableSurface';
import { TruncatedTextWithTooltip } from '../components/TruncatedTextWithTooltip';
import { getComparisonCellValue, getVaryingComparisonFields } from './varietyComparisonFields';

interface VarietyRow {
  crop: Crop;
  label: string;
}

interface VarietiesComparisonTableProps {
  varieties: VarietyRow[];
  cropCrop: Crop;
  onSelect: (crop: Crop) => void;
}

// Reveals the name's link styling for *genuine* keyboard navigation onto the
// row, without it staying stuck on after a mouse click (rows have no other
// focusable element anymore, but a `:focus-visible`-based condition is kept
// here rather than plain `:focus` so a mouse click doesn't show it either —
// consistent with how focus rings behave everywhere else in the app).
const VARIETY_ROW_KEYBOARD_FOCUS_SELECTOR = '.variety-row:focus-visible &';

// Matches the name column of the Fields/Beds hierarchy table: a capped
// width so the column doesn't grow to fit the longest name, with the name
// itself truncating (ellipsis) if it doesn't fit.
const stickyNameCellSx = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  backgroundColor: 'background.paper',
  maxWidth: { xs: 180, sm: 240 },
  // The sticky cell's own opaque background sits on top of the row, so the
  // row's :hover background (set on the <tr>) wouldn't otherwise show
  // through it — mirror it here so the whole row highlights consistently.
  [`.variety-row:hover &, ${VARIETY_ROW_KEYBOARD_FOCUS_SELECTOR}`]: {
    backgroundColor: 'action.selected',
  },
} as const;

export function VarietiesComparisonTable({
  varieties,
  cropCrop,
  onSelect,
}: VarietiesComparisonTableProps) {
  const { t, i18n } = useTranslation('crops');
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);

  // With exactly one variety there's no other variety to compare against,
  // so the columns are driven by "variety vs. general crop" instead of
  // "variety vs. variety" — reusing the same comparison functions by
  // treating the crop as a second, virtual "variety" to diff against (its
  // effective value against itself is just its own raw value, so it acts
  // as the crop baseline with zero special-casing in the comparison logic
  // itself). With 2+ varieties, this is unchanged: purely variety-vs-variety.
  const isSoleVarietyMode = varieties.length === 1;
  const comparisonCrops = isSoleVarietyMode
    ? [varieties[0].crop, cropCrop]
    : varieties.map((variety) => variety.crop);
  const varyingFields = getVaryingComparisonFields(comparisonCrops, cropCrop);
  const showNoDifferencesNotice = isSoleVarietyMode && varyingFields.length === 0;

  return (
    <TableSurface sizingMode="fullWorkspace">
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={stickyNameCellSx}>{t('hierarchy.varietyLabel')}</TableCell>
              {showNoDifferencesNotice ? (
                <TableCell />
              ) : (
                varyingFields.map((field) => (
                  <TableCell key={field.id}>{t(field.labelKey)}</TableCell>
                ))
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {varieties.map(({ crop, label }) => (
              <TableRow
                key={crop.id}
                className="variety-row"
                hover
                tabIndex={0}
                onClick={() => onSelect(crop)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onSelect(crop);
                  }
                }}
                sx={(theme) => ({
                  cursor: 'pointer',
                  '&:hover': { backgroundColor: theme.palette.action.selected },
                  '&:focus-visible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: -2,
                  },
                })}
              >
                <TableCell sx={stickyNameCellSx}>
                  <TruncatedTextWithTooltip
                    text={label}
                    sx={{
                      [`.variety-row:hover &, ${VARIETY_ROW_KEYBOARD_FOCUS_SELECTOR}`]: {
                        color: 'primary.main',
                        textDecoration: 'underline',
                      },
                    }}
                  />
                </TableCell>
                {showNoDifferencesNotice ? (
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {t('hierarchy.soleVarietyNoDifferences')}
                  </TableCell>
                ) : (
                  varyingFields.map((field) => (
                    <TableCell key={field.id}>
                      {getComparisonCellValue(crop, cropCrop, field, t, locale)}
                    </TableCell>
                  ))
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </TableSurface>
  );
}
