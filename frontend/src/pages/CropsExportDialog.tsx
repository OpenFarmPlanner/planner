import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { SpreadsheetExportFormat } from '../crops/spreadsheetExport';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';

type ExportScope = 'current' | 'all';
type ExportFormat = SpreadsheetExportFormat | 'json';

type Translator = (key: string, options?: Record<string, unknown>) => string;

type CropsExportDialogProps = {
  open: boolean;
  hasCurrentCrop: boolean;
  // Default scope depends on the entry point (Import/Export menu -> 'all',
  // a single crop's own kebab menu -> 'current'), but stays changeable.
  initialScope?: ExportScope;
  onClose: () => void;
  onExport: (scope: ExportScope, format: ExportFormat) => Promise<void>;
  t: Translator;
};

export function CropsExportDialog({
  open,
  hasCurrentCrop,
  initialScope = 'all',
  onClose,
  onExport,
  t,
}: CropsExportDialogProps) {
  const [scope, setScope] = useState<ExportScope>(initialScope);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (open) {
      setScope(initialScope);
    }
  }, [open, initialScope]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExport(scope, format);
      onClose();
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('export.dialogTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 0.5 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('export.scopeLabel')}
            </Typography>
            <RadioGroup
              value={scope}
              onChange={(e) => setScope(e.target.value as ExportScope)}
            >
              <FormControlLabel
                value="all"
                control={<Radio size="small" />}
                label={t('export.scopeAll')}
              />
              <FormControlLabel
                value="current"
                control={<Radio size="small" />}
                label={t('export.scopeCurrent')}
                disabled={!hasCurrentCrop}
              />
              {!hasCurrentCrop && scope === 'current' && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
                  {t('export.scopeCurrentDisabled')}
                </Typography>
              )}
            </RadioGroup>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('export.formatLabel')}
            </Typography>
            <RadioGroup
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              <FormControlLabel
                value="xlsx"
                control={<Radio size="small" />}
                label={t('export.formatXlsx')}
              />
              <FormControlLabel
                value="ods"
                control={<Radio size="small" />}
                label={t('export.formatOds')}
              />
              <FormControlLabel
                value="csv"
                control={<Radio size="small" />}
                label={t('export.formatCsv')}
              />
              <FormControlLabel
                value="json"
                control={<Radio size="small" />}
                label={t('export.formatJson')}
              />
            </RadioGroup>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <DisabledActionTooltip title={exporting ? t('common:disabledReasons.busy') : ''}>
          <Button variant="outlined" onClick={onClose} disabled={exporting}>
            {t('export.cancel')}
          </Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip title={exporting ? t('common:disabledReasons.busy') : scope === 'current' && !hasCurrentCrop ? t('export.scopeCurrentDisabled') : ''}>
          <Button
            variant="contained"
            onClick={() => void handleExport()}
            disabled={exporting || (scope === 'current' && !hasCurrentCrop)}
          >
            {t('export.submit')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
