import { useState, useCallback, useRef, type ChangeEvent } from 'react';
import { cropAPI, cropCompanionAPI, type Crop } from '../api/api';
import { buildCompanionItemsByCrop, type CompanionItemsByKind } from '../crops/companions';
import { usePlantFamilies } from '../crops/plantFamilies';
import { normalizeLanguageTag } from '../i18n/languages';
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
  buildCompanionNotePreviewErrors,
  buildImportSuccessMessage,
  mapImportErrors,
} from './cropsPageUtils';
import { analyzeCropImportJson, readFileAsText } from './cropsImportUtils';
import { useCropImportState } from './useCropImportState';
import { applyCropImportBatches, previewCropImportBatches, CropImportBatchError, isImportBodyLimitError, isImportProjectChangedError, type ImportProgress } from './cropImportBatches';

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
  const { t, i18n } = useTranslation(['crops', 'common']);
  const currentLanguage = normalizeLanguageTag(i18n?.resolvedLanguage ?? i18n?.language) ?? 'de';
  const [importNoteLanguage, setImportNoteLanguage] = useState<string>(currentLanguage);
  const [exportNoteLanguage, setExportNoteLanguage] = useState<string>(currentLanguage);
  const [replaceCompanionNotes, setReplaceCompanionNotes] = useState(false);
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
  const applyingRef = useRef(false);
  const attemptedRef = useRef(false);
  const importProjectRef = useRef<number | undefined>(undefined);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const progressLabel = importProgress
    ? t(`import.progress.${importProgress.stage}`, { completed: importProgress.completed, total: importProgress.total }) : undefined;
  const previewError = useCallback((error: unknown) => isImportProjectChangedError(error)
    ? t('import.errors.projectChanged') : isImportBodyLimitError(error)
    ? t('import.errors.bodyLimit') : error instanceof CropImportBatchError
      ? t('import.errors.invalidResponse') : t('import.errors.network'), [t]);

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
    if (applyingRef.current || importPreparingRef.current) return;
    resetImportState();
    setImportProgress(null);
    setImportNoteLanguage(currentLanguage);
    setReplaceCompanionNotes(false);
    setImportStartDialogOpen(true);
  }, [resetImportState, currentLanguage]);

  const prepareImportPreview = useCallback(async (file: File) => {
    resetImportState();
    setConfirmUpdates(false);
    attemptedRef.current = false;
    const projectId = Number(window.localStorage.getItem('activeProjectId'));
    importProjectRef.current = Number.isInteger(projectId) && projectId > 0 ? projectId : undefined;
    setImportProgress(null);
    if (importProjectRef.current === undefined) {
      setImportErrorState({ error: t('import.errors.projectChanged') });
      setImportDialogOpen(true);
      return;
    }

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
          const results = await previewCropImportBatches(entries, importNoteLanguage, setImportProgress, importProjectRef.current);
          const invalidEntries: string[] = [];
          if (skippedRows > 0) invalidEntries.push(t('import.skippedRows', { count: skippedRows }));
          warnings.forEach((w) => invalidEntries.push(w));
          const companionWarning = buildCompanionPreviewWarning(results, t);
          if (companionWarning) invalidEntries.push(companionWarning);
          invalidEntries.push(...buildTimingWindowPreviewWarnings(
            results,
            (index) => rowNumbers[index] ?? index + 2,
            t,
          ));
          invalidEntries.push(...buildCompanionNotePreviewErrors(results, (index) => rowNumbers[index] ?? index + 2, t));
          invalidEntries.push(...buildSpecificPropertyPreviewErrors(results, (index) => rowNumbers[index] ?? index + 2, t));
          setPreviewReadyState({
            previewCount: entries.length + skippedRows,
            validCount: entries.length - results.filter((result) => result.error).length,
            invalidEntries,
            payload: entries,
            previewResults: results.map((result) => ({
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
          setImportErrorState({ error: previewError(error) });
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
          const results = await previewCropImportBatches(importAnalysis.validEntries, importNoteLanguage, setImportProgress, importProjectRef.current);
          const companionWarning = buildCompanionPreviewWarning(results, t);
          setPreviewReadyState({
            previewCount: importAnalysis.originalCount,
            validCount: importAnalysis.validEntries.length - results.filter((result) => result.error).length,
            invalidEntries: [
              ...importAnalysis.invalidEntries,
              ...(companionWarning ? [companionWarning] : []),
              ...buildTimingWindowPreviewWarnings(results, (index) => importAnalysis.rowNumbers[index], t),
              ...buildCompanionNotePreviewErrors(results, (index) => importAnalysis.rowNumbers[index], t),
              ...buildSpecificPropertyPreviewErrors(results, (index) => importAnalysis.rowNumbers[index], t),
            ],
            payload: importAnalysis.validEntries,
            previewResults: results.map(result => ({
              ...result, row_number: importAnalysis.rowNumbers[result.index],
              duplicate_of_row_number: result.duplicate_of_index === undefined ? undefined
                : importAnalysis.rowNumbers[result.duplicate_of_index],
            })),
          });
          setImportDialogOpen(true);
        } catch (error) {
          console.error('Error calling preview endpoint:', error);
          setImportErrorState({ error: previewError(error) });
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
  }, [resetImportState, t, setImportErrorState, setImportUploading, setPreviewReadyState, importNoteLanguage, previewError]);

  const handleImportFileSelected = useCallback(async (file: File) => {
    if (importPreparingRef.current || applyingRef.current) return;
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
    setExportNoteLanguage(currentLanguage);
    setExportDialogInitialScope(initialScope);
    setExportDialogOpen(true);
  }, [currentLanguage]);

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
        exportCropsToSpreadsheet(cropsToExport, format, filename, i18n?.getFixedT ? i18n.getFixedT(exportNoteLanguage, 'crops') : t, companionsByCrop, exportNoteLanguage);
      }
      showSnackbar(t('export.success'), 'success');
    } catch (error) {
      console.error('Error exporting crops:', error);
      showSnackbar(t('messages.fetchError'), 'error');
    }
  }, [loadCompanionsByCrop, selectedCrop, showSnackbar, t, i18n, exportNoteLanguage]);

  const handleImportStart = async () => {
    if (!hasImportableEntries || applyingRef.current || attemptedRef.current) return;
    applyingRef.current = true;
    attemptedRef.current = true;
    setImportUploading();
    try {
      const result = await applyCropImportBatches(importState.payload, importState.previewResults, {
        confirm_updates: confirmUpdates,
        companion_note_language: importNoteLanguage,
        replace_companion_notes: replaceCompanionNotes,
        ...(importProjectRef.current !== undefined ? { expected_project_id: importProjectRef.current } : {}),
      }, setImportProgress);
      const { created_count, updated_count, skipped_count, duplicate_count, errors, companions } = result;
      const summary = [
        buildImportSuccessMessage(created_count, updated_count, skipped_count, t, duplicate_count),
        ...buildCompanionImportMessages(companions, t),
      ].filter(Boolean).join(' ');
      let refreshFailed = false;
      if (result.attempted) {
        try { await fetchCrops(); }
        catch { refreshFailed = true; }
      }
      const failedEntries = mapImportErrors(errors, importState.payload);
      for (const outcome of result.outcomes) {
        const pending = ['not_sent', 'unknown'].includes(outcome.status) ? outcome.status
          : ['not_sent', 'unknown'].includes(outcome.companions ?? '') ? `companions_${outcome.companions}` : null;
        if (pending) failedEntries.push({
          index: outcome.index, name: importState.payload[outcome.index].name as string,
          variety: importState.payload[outcome.index].variety as string | undefined,
          error: '', error_code: pending,
        });
      }
      failedEntries.forEach(entry => {
        entry.row_number = importState.previewResults.find(row => row.index === entry.index)?.row_number ?? entry.index + 1;
        entry.companionPhase = result.outcomes[entry.index]?.companions === 'error';
      });
      if (failedEntries.length || result.interrupted || refreshFailed) {
        const seedRateConstraints = errors.length ? await cropAPI.seedRateConstraints()
          .then(response => response.data.units).catch(() => null) : null;
        const messages = [
          failedEntries.length ? (result.interrupted ? t('import.errors.incomplete')
            : t('import.errors.someFailures', { count: failedEntries.length })) : '',
          result.interrupted?.kind === 'too_large' ? t('import.errors.bodyLimit') : '',
          result.interrupted?.kind === 'invalid_response' ? t('import.errors.invalidResponse') : '',
          result.interrupted?.kind === 'project_changed' ? t('import.errors.projectChanged') : '',
          result.interrupted?.stage === 'finalize' ? t('import.errors.finalize') : '',
          refreshFailed ? t('import.errors.refresh') : '',
        ].filter(Boolean);
        setImportPartialFailure({
          failedEntries: failedEntries.sort((a, b) => a.index - b.index),
          confirmedRows: result.outcomes.filter(row => ['created', 'updated'].includes(row.status))
            .map(row => importState.previewResults.find(preview => preview.index === row.index)?.row_number ?? row.index + 1),
          error: messages.join(' '), summary, seedRateConstraints,
        });
        return;
      }
      setImportSuccessState(summary || t('import.success'));
      setImportDialogOpen(false);
      showSnackbar(summary || t('import.success'), 'success');
    } catch (error) {
      console.error('Error importing crops:', error);
      setImportPartialFailure({ failedEntries: [], error: t('import.errors.network'), summary: t('import.errors.unknown') });
    } finally {
      applyingRef.current = false;
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
    importNoteLanguage, setImportNoteLanguage, exportNoteLanguage, setExportNoteLanguage,
    replaceCompanionNotes, setReplaceCompanionNotes,
    exportDialogOpen,
    exportDialogInitialScope,
    confirmUpdates,
    setConfirmUpdates,
    importState,
    hasImportableEntries,
    handleImportFileTrigger,
    importPreparing,
    progressLabel,
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
