import { useState, useCallback, useRef, type ChangeEvent } from 'react';
import { cropAPI, cropCompanionAPI, type Crop } from '../api/api';
import { buildCompanionItemsByCrop, type CompanionItemsByKind } from '../crops/companions';
import { usePlantFamilies } from '../crops/plantFamilies';
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
import {
  buildCompanionImportMessages,
  buildCompanionPreviewWarning,
  buildTimingWindowPreviewWarnings,
  buildSpecificPropertyPreviewErrors,
  buildImportSuccessMessage,
  mapImportErrors,
} from './cropsPageUtils';
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
  const plantFamilies = usePlantFamilies();

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importStartDialogOpen, setImportStartDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogInitialScope, setExportDialogInitialScope] = useState<ExportScope>('all');
  const [confirmUpdates, setConfirmUpdates] = useState(false);
  // Reading the file and the preview request can take seconds for a long
  // list; the start dialog stays open with a spinner until the preview is ready.
  const [importPreparing, setImportPreparing] = useState(false);
  const importPreparingRef = useRef(false);

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

  const prepareImportPreview = useCallback(async (file: File) => {
    resetImportState();

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isSpreadsheet = ['xlsx', 'ods', 'csv'].includes(ext);

    if (isSpreadsheet) {
      try {
        const { entries, rowNumbers, skippedRows, warnings } = await parseSpreadsheetFile(file);

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
          const companionWarning = buildCompanionPreviewWarning(response.data.results, t);
          if (companionWarning) invalidEntries.push(companionWarning);
          invalidEntries.push(...buildTimingWindowPreviewWarnings(
            response.data.results,
            (index) => rowNumbers[index] ?? index + 2,
            t,
          ));
          invalidEntries.push(...buildSpecificPropertyPreviewErrors(response.data.results, (index) => rowNumbers[index] ?? index + 2, t));
          setPreviewReadyState({
            previewCount: entries.length + skippedRows,
            validCount: entries.length - response.data.results.filter((result) => result.error).length,
            invalidEntries,
            payload: entries,
            previewResults: response.data.results.map((result) => ({
              ...result,
              row_number: rowNumbers?.[result.index] ?? result.index + 2,
              duplicate_of_row_number: result.duplicate_of_index === undefined
                ? undefined
                : rowNumbers?.[result.duplicate_of_index] ?? result.duplicate_of_index + 2,
            })),
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
          const companionWarning = buildCompanionPreviewWarning(response.data.results, t);
          setPreviewReadyState({
            previewCount: importAnalysis.originalCount,
            validCount: importAnalysis.validEntries.length - response.data.results.filter((result) => result.error).length,
            invalidEntries: [
              ...importAnalysis.invalidEntries,
              ...(companionWarning ? [companionWarning] : []),
              ...buildTimingWindowPreviewWarnings(response.data.results, (index) => index + 1, t),
              ...buildSpecificPropertyPreviewErrors(response.data.results, (index) => index + 1, t),
            ],
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

  const handleImportFileSelected = useCallback(async (file: File) => {
    if (importPreparingRef.current) return;
    importPreparingRef.current = true;
    setImportPreparing(true);
    try {
      await prepareImportPreview(file);
    } finally {
      importPreparingRef.current = false;
      setImportPreparing(false);
      setImportStartDialogOpen(false);
    }
  }, [prepareImportPreview]);

  const handleOpenExportDialog = useCallback((initialScope: ExportScope = 'all') => {
    setExportDialogInitialScope(initialScope);
    setExportDialogOpen(true);
  }, []);

  // Called by the command palette (expects separate current/all handlers)
  const handleExportCurrentCrop = useCallback(() => handleOpenExportDialog('current'), [handleOpenExportDialog]);
  const handleExportAllCrops = useCallback(() => handleOpenExportDialog('all'), [handleOpenExportDialog]);

  // Neighbours name their crops, so the whole crop list is needed even when
  // exporting a single Kultur.
  const loadCompanionsByCrop = useCallback(async (): Promise<{
    allCrops: Crop[];
    companionsByCrop: Map<number, CompanionItemsByKind>;
  }> => {
    const [allCrops, relations] = await Promise.all([
      cropAPI.listAll().then((response) => response.results),
      cropCompanionAPI.list().then((response) => response.data),
    ]);
    return { allCrops, companionsByCrop: buildCompanionItemsByCrop(allCrops, relations, plantFamilies.getName) };
  }, [plantFamilies.getName]);

  const handleExport = useCallback(async (scope: ExportScope, format: ExportFormat) => {
    try {
      const { allCrops, companionsByCrop } = await loadCompanionsByCrop();
      const exportsSingleCrop = scope === 'current' && selectedCrop;
      if (format === 'json') {
        if (exportsSingleCrop) {
          const exportPayload = buildSingleCropExport(selectedCrop, undefined, companionsByCrop);
          const filename = buildSingleCropFilename(selectedCrop);
          downloadJsonFile(exportPayload, filename);
        } else {
          const exportPayload = buildAllCropsExport(allCrops, undefined, companionsByCrop);
          const filename = buildAllCropsFilename();
          downloadJsonFile(exportPayload, filename);
        }
      } else {
        const cropsToExport: Crop[] = exportsSingleCrop ? [selectedCrop] : allCrops;
        const filename = buildSpreadsheetFilename(format, scope === 'current' ? 'single' : 'all', selectedCrop ?? undefined);
        exportCropsToSpreadsheet(cropsToExport, format, filename, t, companionsByCrop);
      }
      showSnackbar(t('export.success'), 'success');
    } catch (error) {
      console.error('Error exporting crops:', error);
      showSnackbar(t('messages.fetchError'), 'error');
    }
  }, [loadCompanionsByCrop, selectedCrop, showSnackbar, t]);

  const handleImportStart = async () => {
    if (!hasImportableEntries || importState.status === 'uploading') return;

    setImportUploading();

    try {
      const response = await cropAPI.importApply({
        items: importState.payload,
        confirm_updates: confirmUpdates,
      });

      const { created_count, updated_count, skipped_count, duplicate_count, errors, companions } = response.data;
      const summary = [
        buildImportSuccessMessage(created_count, updated_count, skipped_count, t, duplicate_count),
        ...buildCompanionImportMessages(companions, t),
      ].filter(Boolean).join(' ');
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
    importPreparing,
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
