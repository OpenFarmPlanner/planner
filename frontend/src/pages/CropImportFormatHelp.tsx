import { Alert, Box, Button, Collapse, List, ListItem, ListItemText, Typography } from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useState } from 'react';
import { downloadCropImportTemplate } from '../crops/importTemplate';
import { getLocalizedCropColumns, LIST_CELL_SEPARATOR } from '../crops/spreadsheetColumns';
import { emptyTimingWindow, formatTimingWindow } from '../crops/timingWindows';
import type { SpreadsheetExportFormat } from '../crops/spreadsheetExport';
import LoadRetryButton from '../components/LoadRetryButton';
import { loadRetryAlertSx } from '../components/loadRetryStyles';

type Translator = (key: string, options?: Record<string, unknown>) => string;

// Offset the theme's 24px button padding so the label lines up with the
// hint above, and keep a wrapped label left-aligned on narrow screens.
const linkButtonSx = { ml: -3, textAlign: 'left', justifyContent: 'flex-start' } as const;

type HelpSection = { key: string; intro?: string; rules: string[]; outro?: string };
type ValueGroupKey = 'seed' | 'site' | 'cultivation' | 'other';
type LocalizedColumn = ReturnType<typeof getLocalizedCropColumns>[number];

/** Allowed values by topic; a column missing here lands in "other" so it is never hidden. */
const VALUE_GROUP_BY_COLUMN: Record<string, ValueGroupKey> = {
  seed_type: 'seed',
  germination_temperature_requirement: 'seed',
  germination_light_requirement: 'seed',
  germination_types: 'seed',
  light_requirement: 'site',
  water_requirement: 'site',
  nutrient_demand: 'site',
  life_cycle: 'site',
  winter_hardiness: 'site',
  cultivation_types: 'cultivation',
  seed_rate_direct_unit: 'cultivation',
  seed_rate_pre_cultivation_unit: 'cultivation',
  harvest_method: 'cultivation',
};
const VALUE_GROUP_ORDER: ValueGroupKey[] = ['seed', 'site', 'cultivation', 'other'];

function groupEnumColumns(columns: LocalizedColumn[]): { key: ValueGroupKey; columns: LocalizedColumn[] }[] {
  return VALUE_GROUP_ORDER
    .map((key) => ({ key, columns: columns.filter((column) => (VALUE_GROUP_BY_COLUMN[column.key] ?? 'other') === key) }))
    .filter((group) => group.columns.length > 0);
}

/**
 * The import's accepted file format, from the same column definitions the
 * import reads, so the help cannot drift from what is actually accepted.
 */
export function CropImportFormatHelp({ t }: { t: Translator }) {
  const [open, setOpen] = useState(false);
  const [templatePending, setTemplatePending] = useState<SpreadsheetExportFormat | null>(null);
  const [templateError, setTemplateError] = useState<SpreadsheetExportFormat | null>(null);
  const downloadTemplate = async (format: SpreadsheetExportFormat) => {
    setTemplatePending(format);
    setTemplateError(null);
    try {
      await downloadCropImportTemplate(t, format);
    } catch {
      setTemplateError(format);
    } finally {
      setTemplatePending(null);
    }
  };
  const columns = getLocalizedCropColumns(t);
  const header = (key: string) => columns.find((column) => column.key === key)?.header ?? key;
  const seedUnitLabels = columns.find((column) => column.key === 'seed_rate_pre_cultivation_unit')?.enumExport ?? {};
  const cultivationLabels = Object.values(columns.find((column) => column.key === 'cultivation_types')?.enumExport ?? {});
  const timingWindowExample = (start: number, startDecade: 'early' | 'late', end: number, endDecade: 'mid' | 'late') => formatTimingWindow(
    { ...emptyTimingWindow('direct_sowing', 'decade'), start_month: start, start_decade: startDecade, end_month: end, end_decade: endDecade },
    t,
  );

  const sections: HelpSection[] = [
    { key: 'basics', rules: [
      t('import.help.basics.required', { name: header('name') }),
      t('import.help.basics.numbers'),
      t('import.help.basics.multipleValues', { example: cultivationLabels.join(LIST_CELL_SEPARATOR) }),
      t('import.help.basics.color', { column: header('display_color') }),
    ] },
    { key: 'varieties', rules: [
      t('import.help.varieties.withoutVariety', { variety: header('variety') }),
      t('import.help.varieties.withVariety', {
        variety: header('variety'), nutrient: header('nutrient_demand'), cultivation: header('cultivation_types'),
      }),
      t('import.help.varieties.matching', { confirm: t('import.confirmUpdates') }),
    ] },
    { key: 'quantities', rules: [
      t('import.help.quantities.yield', { yield: header('expected_yield'), unit: header('harvest_method') }),
      t('import.help.quantities.wholeSeeds', { unit: seedUnitLabels.seeds_per_plant ?? 'seeds_per_plant' }),
    ] },
    { key: 'timing', intro: t('import.help.timing.intro', {
      columns: columns.filter((column) => column.type === 'timingWindows').map((column) => column.header).join(', '),
      cultivation: header('cultivation_types'),
    }), rules: [
      t('import.help.timing.written', {
        decadeExample: timingWindowExample(3, 'early', 5, 'mid'),
        monthExample: timingWindowExample(3, 'early', 3, 'late'),
      }),
      t('import.help.timing.weeks', {
        weekExample: formatTimingWindow({ ...emptyTimingWindow('planting', 'iso_week'), start_week: 10, end_week: 14 }, t),
      }),
      t('import.help.timing.short'),
      t('import.help.timing.several'),
      t('import.help.timing.noDates'),
    ], outro: t('import.help.timing.preview') },
    { key: 'notes', intro: t('import.help.notes.intro', {
      good: header('good_companions'), bad: header('bad_companions'),
    }), rules: [
      t('import.help.notes.separators'),
      t('import.help.notes.noteEnds'),
      t('import.help.notes.example'),
      t('import.help.notes.meaning'),
      t('import.help.notes.legacy'),
      t('import.help.notes.keepQuotes'),
    ] },
  ];
  const valueGroups = groupEnumColumns(columns.filter((column) => column.enumExport));

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5,
      '& > .MuiAlert-root': {
        flexWrap: { xs: 'wrap', sm: 'nowrap' },
        '& .MuiAlert-action': {
          width: { xs: '100%', sm: 'auto' },
          pl: { xs: 0, sm: 2 },
          justifyContent: 'flex-end',
        },
      },
    }}>
      <Typography variant="body2" color="text.secondary">
        {t('import.help.templateHint')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1 }}>
        <Button
          type="button"
          variant="text"
          startIcon={<FileDownloadOutlinedIcon />}
          onClick={() => void downloadTemplate('ods')}
          disabled={templatePending !== null}
          loading={templatePending === 'ods'}
          sx={linkButtonSx}
        >
          {t('import.help.templateButton')}
        </Button>
        <Button
          type="button"
          variant="text"
          size="small"
          onClick={() => void downloadTemplate('xlsx')}
          disabled={templatePending !== null}
          loading={templatePending === 'xlsx'}
        >
          {t('import.help.templateButtonXlsx')}
        </Button>
      </Box>
      {templateError ? <Alert severity="error" sx={loadRetryAlertSx} action={<LoadRetryButton onClick={() => void downloadTemplate(templateError)} />}>
        {t('import.help.templateError')}
      </Alert> : null}
      <Typography variant="body2" color="text.secondary">
        {t('import.help.templateSamples')}
      </Typography>
      <Button
        type="button"
        variant="text"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        sx={linkButtonSx}
      >
        {t('import.help.toggle')}
      </Button>
      <Collapse in={open} unmountOnExit sx={{ width: '100%' }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {t('import.help.exportTip')}
        </Typography>
        {sections.map((section) => (
          <Box key={section.key} component="section" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" component="h3">
              {t(`import.help.sections.${section.key}`)}
            </Typography>
            {section.intro ? <Typography variant="body2">{section.intro}</Typography> : null}
            <List dense disablePadding>
              {section.rules.map((rule) => (
                <ListItem key={rule} disableGutters>
                  <ListItemText primary={rule} />
                </ListItem>
              ))}
            </List>
            {section.outro ? <Typography variant="body2">{section.outro}</Typography> : null}
          </Box>
        ))}
        <Typography variant="subtitle2" component="h3">
          {t('import.help.valuesTitle')}
        </Typography>
        {valueGroups.map((group) => (
          <Box key={group.key} component="section">
            <Typography variant="subtitle2" component="h4" color="text.secondary" sx={{ mt: 1 }}>
              {t(`import.help.valueGroups.${group.key}`)}
            </Typography>
            <List dense disablePadding>
              {group.columns.map((column) => (
                <ListItem key={column.key} disableGutters>
                  <ListItemText
                    primary={column.header}
                    secondary={Object.values(column.enumExport ?? {}).join(', ')}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        ))}
      </Collapse>
    </Box>
  );
}
