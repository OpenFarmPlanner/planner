import { useState, useCallback, type ChangeEvent } from 'react';
import { cropAPI, type Crop } from '../api/api';
import { useTranslation } from '../i18n';
import {
  buildAllCropsExport,
  buildAllCropsFilename,
  buildSingleCropExport,
  buildSingleCropFilename,
  downloadJsonFile,
} from '../crops/exportUtils';
import { exportCropsToSpreadsheet, buildSpreadsheetFilename, type SpreadsheetExportFormat } from '../crops/spreadsheetExport';
import { parseSpreadsheetFile } from '../crops/spreadsheetImport';
import { buildImportSuccessMessage, mapImportErrors } from './cropsPageUtils';
import { analyzeCropImportJson, readFileAsText } from './cropsImportUtils';
import { useCropImportState } from './useCropImportState';

export type ExportFormat = SpreadsheetExportFormat | 'json';
export type ExportScope = 'current' | 'all';

interface UseCropImportExportConfig {
  selectedCrop: Crop | undefined;
  fetchCrops: () => Promise<void>;
  showSnackbar: (message: string, severity: 'success' | 'error' | 'info') => void;
}

export function useCropImportExport({
  selectedCrop,
  fetchCrops,
  showSnackbar,
}: UseCropImportExportConfig) {
  const { t } = useTranslation(['crops', 'common']);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importStartDialogOpen, setImportStartDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogInitialScope, setExportDialogInitialScope] = useState<ExportScope>('all');
  const [confirmUpdates, setConfirmUpdates] = useState(false);

  const {
    state: importState,
    hasImportableEntries,
    reset: resetImportState,
    setErrorState: setImportErrorState,
    setPreviewReadyState,
    setUploading: setImportUploading,
    setPartialFailure: setImportPartialFailure,
    setSuccessState: setImportSuccessState,
  } = useCropImportState();

  const handleImportFileTrigger = useCallback(() => {
    resetImportState();
    setImportStartDialogOpen(true);
  }, [resetImportState]);

  const handleImportFileSelected = useCallback(async (file: File) => {
    setImportStartDialogOpen(false);
    resetImportState();

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isSpreadsheet = ['xlsx', 'ods', 'csv'].includes(ext);

    if (isSpreadsheet) {
      try {
        const { entries, skippedRows, warnings } = await parseSpreadsheetFile(file);

        if (entries.length === 0) {
          const warningText = warnings.length > 0 ? warnings.join(' ') : t('import.errors.noValidEntries');
          setImportErrorState({ error: warningText, previewCount: skippedRows, validCount: 0, invalidEntries: [] });
          setImportDialogOpen(true);
          return;
        }

        setImportUploading();
        try {
          const response = await cropAPI.importPreview(entries);
          const invalidEntries: string[] = [];
          if (skippedRows > 0) invalidEntries.push(t('import.skippedRows', { count: skippedRows }));
          warnings.forEach((w) => invalidEntries.push(w));
          setPreviewReadyState({
            previewCount: entries.length + skippedRows,
            validCount: entries.length,
            invalidEntries,
            payload: entries,
            previewResults: response.data.results,
          });
          setImportDialogOpen(true);
        } catch (error) {
          console.error('Error calling preview endpoint:', error);
          setImportErrorState({ error: t('import.errors.network') });
          setImportDialogOpen(true);
        }
      } catch (error) {
        console.error('Error parsing spreadsheet file:', error);
        setImportErrorState({ error: t('import.errors.parse') });
        setImportDialogOpen(true);
      }
      return;
    }

    if (ext === 'json') {
      try {
        const jsonString = await readFileAsText(file);
        const importAnalysis = analyzeCropImportJson(jsonString, t);

        if (importAnalysis.status === 'error') {
          setImportErrorState({
            error: t(importAnalysis.errorKey),
            previewCount: importAnalysis.originalCount,
            validCount: 0,
            invalidEntries: importAnalysis.invalidEntries,
          });
          setImportDialogOpen(true);
          return;
        }

        setImportUploading();
        try {
          const response = await cropAPI.importPreview(importAnalysis.validEntries);
          setPreviewReadyState({
            previewCount: importAnalysis.originalCount,
            validCount: importAnalysis.validEntries.length,
            invalidEntries: importAnalysis.invalidEntries,
            payload: importAnalysis.validEntries,
            previewResults: response.data.results,
          });
          setImportDialogOpen(true);
        } catch (error) {
          console.error('Error calling preview endpoint:', error);
          setImportErrorState({ error: t('import.errors.network') });
          setImportDialogOpen(true);
        }
      } catch (error) {
        console.error('Error reading JSON file:', error);
        setImportErrorState({ error: t('import.errors.parse') });
        setImportDialogOpen(true);
      }
      return;
    }

    setImportErrorState({ error: t('import.errors.unsupportedFormat') });
    setImportDialogOpen(true);
  }, [resetImportState, t, setImportErrorState, setImportUploading, setPreviewReadyState]);

  const handleOpenExportDialog = useCallback((initialScope: ExportScope = 'all') => {
    setExportDialogInitialScope(initialScope);
    setExportDialogOpen(true);
  }, []);

  // Called by the command palette (expects separate current/all handlers)
  const handleExportCurrentCrop = useCallback(() => handleOpenExportDialog('current'), [handleOpenExportDialog]);
  const handleExportAllCrops = useCallback(() => handleOpenExportDialog('all'), [handleOpenExportDialog]);

  const handleExport = useCallback(async (scope: ExportScope, format: ExportFormat) => {
    try {
      if (format === 'json') {
        if (scope === 'current' && selectedCrop) {
          const exportPayload = buildSingleCropExport(selectedCrop);
          const filename = buildSingleCropFilename(selectedCrop);
          downloadJsonFile(exportPayload, filename);
        } else {
          const { results: allCrops } = await cropAPI.listAll();
          const exportPayload = buildAllCropsExport(allCrops);
          const filename = buildAllCropsFilename();
          downloadJsonFile(exportPayload, filename);
        }
      } else {
        const cropsToExport: Crop[] = scope === 'current' && selectedCrop
          ? [selectedCrop]
          : (await cropAPI.listAll()).results;
        const filename = buildSpreadsheetFilename(format, scope === 'current' ? 'single' : 'all', selectedCrop ?? undefined);
        exportCropsToSpreadsheet(cropsToExport, format, filename, t);
      }
      showSnackbar(t('export.success'), 'success');
    } catch (error) {
      console.error('Error exporting crops:', error);
      showSnackbar(t('messages.fetchError'), 'error');
    }
  }, [selectedCrop, showSnackbar, t]);

  const handleImportStart = async () => {
    if (!hasImportableEntries || importState.status === 'uploading') return;

    setImportUploading();

    try {
      const response = await cropAPI.importApply({
        items: importState.payload,
        confirm_updates: confirmUpdates,
      });

      const { created_count, updated_count, skipped_count, errors } = response.data;
      const summary = buildImportSuccessMessage(created_count, updated_count, skipped_count, t);
      // Rows that went through are saved even when others failed.
      if (created_count + updated_count > 0) {
        await fetchCrops();
      }

      if (errors.length > 0) {
        const seedRateConstraints = await cropAPI.seedRateConstraints()
          .then((constraintsResponse) => constraintsResponse.data.units)
          .catch(() => null);
        setImportPartialFailure({
          failedEntries: mapImportErrors(errors, importState.payload),
          error: t('import.errors.someFailures', { count: errors.length }),
          summary,
          seedRateConstraints,
        });
        return;
      }

      setImportSuccessState(summary || t('import.success'));
      setImportDialogOpen(false);
      showSnackbar(summary || t('import.success'), 'success');
    } catch (error) {
      console.error('Error importing crops:', error);
      setImportErrorState({ error: t('import.errors.network') });
    }
  };

  const handleImportDialogClose = () => {
    setImportDialogOpen(false);
  };

  // Legacy: kept for compatibility with hidden <input> path (unused when dialogs are active)
  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await handleImportFileSelected(file);
  };

  return {
    importDialogOpen,
    importStartDialogOpen,
    exportDialogOpen,
    exportDialogInitialScope,
    confirmUpdates,
    setConfirmUpdates,
    importState,
    hasImportableEntries,
    handleImportFileTrigger,
    handleImportFileSelected,
    handleImportFileChange,
    handleOpenExportDialog,
    handleExportCurrentCrop,
    handleExportAllCrops,
    handleExport,
    handleImportStart,
    handleImportDialogClose,
    setImportStartDialogOpen,
    setExportDialogOpen,
  };
}
