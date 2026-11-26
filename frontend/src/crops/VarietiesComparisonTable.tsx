import { useContext, useMemo } from 'react';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import type { Crop } from '../api/types';
import { AuthContext } from '../auth/authContextShared';
import { useTranslation } from '../i18n';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';
import TableSurface from '../components/layout/TableSurface';
import { TruncatedTextWithTooltip } from '../components/TruncatedTextWithTooltip';
import { TableColumnDivider } from '../components/data-grid/TableColumnDivider';
import { useGridColumnSizing } from '../components/data-grid/useGridColumnSizing';
import type { ColumnMeasurement } from '../components/data-grid/gridContentWidths';
import { CROP_COMPARISON_FIELDS, getComparisonCellValue, getVaryingComparisonFields } from './varietyComparisonFields';
import { usePlantFamilies } from './plantFamilies';

interface VarietyRow {
  crop: Crop;
  label: string;
}

interface VarietiesComparisonTableProps {
  varieties: VarietyRow[];
  cropCrop: Crop;
  onSelect: (crop: Crop) => void;
  publicLibrary?: boolean;
}

// Reveals the name's link styling for *genuine* keyboard navigation onto the
// row, without it staying stuck on after a mouse click (rows have no other
// focusable element anymore, but a `:focus-visible`-based condition is kept
// here rather than plain `:focus` so a mouse click doesn't show it either —
// consistent with how focus rings behave everywhere else in the app).
const VARIETY_ROW_KEYBOARD_FOCUS_SELECTOR = '.variety-row:focus-visible &';

const stickyNameCellSx = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  backgroundColor: 'background.paper',
  // The sticky cell's own opaque background sits on top of the row, so the
  // row's :hover background (set on the <tr>) wouldn't otherwise show
  // through it — mirror it here so the whole row highlights consistently.
  [`.variety-row:hover &, ${VARIETY_ROW_KEYBOARD_FOCUS_SELECTOR}`]: {
    backgroundColor: 'action.selected',
  },
} as const;
const NOTICE_WIDTH = 320;

export function VarietiesComparisonTable({
  varieties,
  cropCrop,
  onSelect,
  publicLibrary = false,
}: VarietiesComparisonTableProps) {
  const { t, i18n } = useTranslation('crops');
  const auth = useContext(AuthContext);
  const plantFamilies = usePlantFamilies();
  const comparisonFormatContext = useMemo(
    () => ({ getPlantFamilyName: plantFamilies.getName }),
    [plantFamilies],
  );
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
  const { definitions, measurements } = useMemo(() => {
    const makeColumn = (field: string, label: string): GridColDef<VarietyRow> =>
      ({ field, headerName: label, sortable: false, disableColumnMenu: true });
    const header = (text: string) => ({ text, fontWeight: 600, extra: 24 });
    const nameLabel = t('hierarchy.varietyLabel');
    const definitions = [makeColumn('variety', nameLabel)];
    const measurements: Record<string, ColumnMeasurement<VarietyRow>> = {
      variety: { header: header(nameLabel), cell: row => ({ text: row.label }), defaultMax: 240 },
    };
    for (const field of CROP_COMPARISON_FIELDS) {
      const label = t(field.labelKey);
      definitions.push(makeColumn(field.id, label));
      measurements[field.id] = {
        header: header(label),
        cell: row => ({ text: getComparisonCellValue(row.crop, cropCrop, field, t, locale, comparisonFormatContext) }),
      };
    }
    return { definitions, measurements };
  }, [comparisonFormatContext, cropCrop, locale, t]);
  const sizing = useGridColumnSizing(
    definitions, publicLibrary ? 'publicCropVarieties' : 'cropVarieties',
    auth?.user?.id, publicLibrary ? null : auth?.activeProjectId,
    { rows: varieties, ready: true, scope: `${locale}:${cropCrop.id ?? ''}:${plantFamilies.loaded}`, measurements },
  );
  const visibleFields = new Set(['variety', ...varyingFields.map(field => field.id)]);
  const visibleColumns = sizing.columns.filter(column => visibleFields.has(column.field));
  const tableWidth = visibleColumns.reduce((sum, column) => sum + column.width, showNoDifferencesNotice ? NOTICE_WIDTH : 0);

  return (
    <TableSurface sizingMode="fullWorkspace">
      <TableContainer data-testid="varieties-comparison-table" sx={{ '& .MuiTableCell-body': { px: 1.25 } }}>
        <Table size="small" style={{ width: tableWidth, tableLayout: 'fixed' }}>
          <colgroup>
            {visibleColumns.map(column => <col key={column.field} style={{ width: column.width }} />)}
            {showNoDifferencesNotice && <col style={{ width: NOTICE_WIDTH }} />}
          </colgroup>
          <TableHead>
            <TableRow>
              {visibleColumns.map(column => (
                <TableCell
                  key={column.field}
                  scope="col"
                  data-field={column.field}
                  sx={[{ position: 'relative', pl: 1.25, pr: 3 }, column.field === 'variety' && stickyNameCellSx]}
                >
                  <TruncatedTextWithTooltip text={column.headerName ?? column.field} />
                  <TableColumnDivider
                    label={`${t('common:actions.autoFitColumnWidth')} (${column.headerName})`}
                    width={column.width}
                    onResize={width => sizing.setUserWidth(column.field, width)}
                    onAutoFit={() => {
                      const fitted = sizing.autoFit?.(column.field);
                      if (fitted !== undefined) sizing.setUserWidth(column.field, fitted);
                    }}
                  />
                </TableCell>
              ))}
              {showNoDifferencesNotice && <TableCell />}
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
                      <TruncatedTextWithTooltip text={getComparisonCellValue(crop, cropCrop, field, t, locale, comparisonFormatContext)} />
                    </TableCell>
                  ))
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {sizing.widthReset.enabled && (
        <Button size="small" onClick={sizing.widthReset.reset}>{t('common:actions.resetColumnWidths')}</Button>
      )}
    </TableSurface>
  );
}
