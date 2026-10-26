import { Box, Button, Collapse, List, ListItem, ListItemText, Typography } from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useState } from 'react';
import { downloadCropImportTemplate } from '../crops/importTemplate';
import { getLocalizedCropColumns } from '../crops/spreadsheetColumns';

type Translator = (key: string, options?: Record<string, unknown>) => string;

// Offset the theme's 24px button padding so the label lines up with the
// hint above, and keep a wrapped label left-aligned on narrow screens.
const linkButtonSx = { ml: -3, textAlign: 'left', justifyContent: 'flex-start' } as const;

/**
 * The import's accepted file format, from the same column definitions the
 * import reads, so the help cannot drift from what is actually accepted.
 */
export function CropImportFormatHelp({ t }: { t: Translator }) {
  const [open, setOpen] = useState(false);
  const columns = getLocalizedCropColumns(t);
  const header = (key: string) => columns.find((column) => column.key === key)?.header ?? key;
  const enumColumns = columns.filter((column) => column.enumExport);
  const seedUnitLabels = columns.find((column) => column.key === 'seed_rate_pre_cultivation_unit')?.enumExport ?? {};
  const cultivationLabels = Object.values(columns.find((column) => column.key === 'cultivation_types')?.enumExport ?? {});

  const rules = [
    t('import.help.rules.required', { name: header('name') }),
    t('import.help.rules.varietyRows', {
      variety: header('variety'),
      nutrient: header('nutrient_demand'),
      cultivation: header('cultivation_types'),
    }),
    t('import.help.rules.numbers'),
    t('import.help.rules.cultivationTypes', { example: cultivationLabels.join(', ') }),
    t('import.help.rules.wholeSeeds', { unit: seedUnitLabels.seeds_per_plant ?? 'seeds_per_plant' }),
    t('import.help.rules.color', { column: header('display_color') }),
    t('import.help.rules.matching', { confirm: t('import.confirmUpdates') }),
    t('import.help.rules.exportTip'),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
      <Typography variant="body2" color="text.secondary">
        {t('import.help.templateHint')}
      </Typography>
      <Button
        type="button"
        variant="text"
        startIcon={<FileDownloadOutlinedIcon />}
        onClick={() => downloadCropImportTemplate(t)}
        sx={linkButtonSx}
      >
        {t('import.help.templateButton')}
      </Button>
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
        <List dense disablePadding>
          {rules.map((rule) => (
            <ListItem key={rule} disableGutters>
              <ListItemText primary={rule} />
            </ListItem>
          ))}
        </List>
        <Typography variant="subtitle2" sx={{ mt: 1 }}>
          {t('import.help.valuesTitle')}
        </Typography>
        <List dense disablePadding>
          {enumColumns.map((column) => (
            <ListItem key={column.key} disableGutters>
              <ListItemText
                primary={column.header}
                secondary={Object.values(column.enumExport ?? {}).join(', ')}
              />
            </ListItem>
          ))}
        </List>
      </Collapse>
    </Box>
  );
}
