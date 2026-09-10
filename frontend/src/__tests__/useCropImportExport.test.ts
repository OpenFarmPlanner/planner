import { act, renderHook } from '@testing-library/react';
import { useCropImportExport } from '../pages/useCropImportExport';
import type { Crop } from '../api/api';

const api = vi.hoisted(() => ({
  importPreview: vi.fn(),
  importApply: vi.fn(),
  listAll: vi.fn(),
}));
const spreadsheet = vi.hoisted(() => ({ parse: vi.fn(), exportToSpreadsheet: vi.fn() }));
const json = vi.hoisted(() => ({ downloadJson: vi.fn(), readFileAsText: vi.fn(), analyze: vi.fn() }));

vi.mock('../api/api', () => ({
  cropAPI: { importPreview: api.importPreview, importApply: api.importApply, listAll: api.listAll },
}));
vi.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../crops/spreadsheetImport', () => ({ parseSpreadsheetFile: spreadsheet.parse }));
vi.mock('../crops/spreadsheetExport', () => ({
  exportCropsToSpreadsheet: spreadsheet.exportToSpreadsheet,
  buildSpreadsheetFilename: () => 'crops.xlsx',
}));
vi.mock('../crops/exportUtils', () => ({
  buildAllCropsExport: (crops: unknown) => ({ crops }),
  buildAllCropsFilename: () => 'all.json',
  buildSingleCropExport: (crop: unknown) => ({ crop }),
  buildSingleCropFilename: () => 'one.json',
  downloadJsonFile: json.downloadJson,
}));
vi.mock('../pages/cropsImportUtils', () => ({
  readFileAsText: json.readFileAsText,
  analyzeCropImportJson: json.analyze,
}));

const CROP = { id: 1, name: 'Tomate' } as Crop;
const file = (name: string) => new File(['x'], name);

/**
 * Pass `null` for "no crop selected". Not `undefined` — that would trigger the
 * default parameter and silently give the hook a selection after all.
 */
function setup(selectedCrop: Crop | null = CROP) {
  const fetchCrops = vi.fn().mockResolvedValue(undefined);
  const showSnackbar = vi.fn();
  const view = renderHook(() => useCropImportExport({
    selectedCrop: selectedCrop ?? undefined,
    fetchCrops,
    showSnackbar,
  }));
  return { ...view, fetchCrops, showSnackbar };
}

describe('useCropImportExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.importPreview.mockResolvedValue({ data: { results: [] } });
    api.importApply.mockResolvedValue({ data: { created_count: 1, updated_count: 0, skipped_count: 0, errors: [] } });
    api.listAll.mockResolvedValue({ results: [CROP] });
    spreadsheet.parse.mockResolvedValue({ entries: [{ name: 'Tomate' }], skippedRows: 0, warnings: [] });
    json.readFileAsText.mockResolvedValue('[]');
    json.analyze.mockReturnValue({ status: 'ok', validEntries: [{ name: 'Tomate' }], originalCount: 1, invalidEntries: [] });
  });

  describe('choosing a file', () => {
    it.each([['xlsx'], ['ods'], ['csv']])('parses a .%s file as a spreadsheet', async (ext) => {
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file(`c.${ext}`)); });

      expect(spreadsheet.parse).toHaveBeenCalled();
      expect(json.readFileAsText).not.toHaveBeenCalled();
    });

    it('reads a .json file as JSON', async () => {
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('c.json')); });

      expect(json.readFileAsText).toHaveBeenCalled();
      expect(spreadsheet.parse).not.toHaveBeenCalled();
    });

    it('ignores the case of the extension', async () => {
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('c.XLSX')); });

      expect(spreadsheet.parse).toHaveBeenCalled();
    });

    it('rejects any other extension without reading the file', async () => {
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('c.pdf')); });

      expect(spreadsheet.parse).not.toHaveBeenCalled();
      expect(json.readFileAsText).not.toHaveBeenCalled();
      expect(view.result.current.importState.status).toBe('error');
      expect(view.result.current.importDialogOpen).toBe(true);
    });

    it('rejects a file with no extension at all', async () => {
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('crops')); });

      expect(view.result.current.importState.status).toBe('error');
    });
  });

  describe('the preview step', () => {
    it('opens the dialog with a preview when the file has entries', async () => {
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('c.csv')); });

      expect(api.importPreview).toHaveBeenCalledWith([{ name: 'Tomate' }]);
      expect(view.result.current.importDialogOpen).toBe(true);
      expect(view.result.current.hasImportableEntries).toBe(true);
    });

    it('reports the file’s own warnings when it yields no entries', async () => {
      spreadsheet.parse.mockResolvedValue({ entries: [], skippedRows: 2, warnings: ['unbekannte Spalte'] });
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('c.csv')); });

      expect(api.importPreview).not.toHaveBeenCalled();
      expect(view.result.current.importState.status).toBe('error');
      expect(view.result.current.importState.error).toContain('unbekannte Spalte');
    });

    it('counts skipped rows alongside the imported ones', async () => {
      spreadsheet.parse.mockResolvedValue({ entries: [{ name: 'A' }], skippedRows: 3, warnings: [] });
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('c.csv')); });

      expect(view.result.current.importState.previewCount).toBe(4);
      expect(view.result.current.importState.validCount).toBe(1);
    });

    it('surfaces a failing preview request as an error', async () => {
      api.importPreview.mockRejectedValue(new Error('boom'));
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('c.csv')); });

      expect(view.result.current.importState.status).toBe('error');
      expect(view.result.current.importDialogOpen).toBe(true);
    });

    it('surfaces an unreadable file as an error', async () => {
      spreadsheet.parse.mockRejectedValue(new Error('boom'));
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('c.csv')); });

      expect(view.result.current.importState.status).toBe('error');
    });

    it('stops before the preview when the JSON is rejected', async () => {
      json.analyze.mockReturnValue({
        status: 'error', errorKey: 'import.errors.parse', originalCount: 2, invalidEntries: ['Zeile 1'],
      });
      const view = setup();

      await act(async () => { await view.result.current.handleImportFileSelected(file('c.json')); });

      expect(api.importPreview).not.toHaveBeenCalled();
      expect(view.result.current.importState.status).toBe('error');
      expect(view.result.current.importState.invalidEntries).toEqual(['Zeile 1']);
    });
  });

  describe('applying the import', () => {
    async function reachPreview(view: ReturnType<typeof setup>) {
      await act(async () => { await view.result.current.handleImportFileSelected(file('c.csv')); });
    }

    it('sends the previewed entries and the confirm flag', async () => {
      const view = setup();
      await reachPreview(view);
      act(() => { view.result.current.setConfirmUpdates(true); });

      await act(async () => { await view.result.current.handleImportStart(); });

      expect(api.importApply).toHaveBeenCalledWith({
        items: [{ name: 'Tomate' }],
        confirm_updates: true,
      });
    });

    it('reloads the crop list once the import succeeds', async () => {
      const view = setup();
      await reachPreview(view);

      await act(async () => { await view.result.current.handleImportStart(); });

      expect(view.fetchCrops).toHaveBeenCalled();
      expect(view.result.current.importState.status).toBe('success');
    });

    it('does not reload when some entries failed', async () => {
      api.importApply.mockResolvedValue({
        data: { created_count: 0, updated_count: 0, skipped_count: 0, errors: [{ index: 0, message: 'nope' }] },
      });
      const view = setup();
      await reachPreview(view);

      await act(async () => { await view.result.current.handleImportStart(); });

      expect(view.fetchCrops).not.toHaveBeenCalled();
      expect(view.result.current.importState.status).not.toBe('success');
    });

    it('reports a failing request without reloading', async () => {
      api.importApply.mockRejectedValue(new Error('boom'));
      const view = setup();
      await reachPreview(view);

      await act(async () => { await view.result.current.handleImportStart(); });

      expect(view.fetchCrops).not.toHaveBeenCalled();
      expect(view.result.current.importState.status).toBe('error');
    });

    it('does nothing when there is nothing to import', async () => {
      const view = setup();

      await act(async () => { await view.result.current.handleImportStart(); });

      expect(api.importApply).not.toHaveBeenCalled();
    });
  });

  describe('exporting', () => {
    it('exports only the selected crop as JSON, without fetching the list', async () => {
      const view = setup();

      await act(async () => { await view.result.current.handleExport('current', 'json'); });

      expect(api.listAll).not.toHaveBeenCalled();
      expect(json.downloadJson).toHaveBeenCalledWith({ crop: CROP }, 'one.json');
    });

    it('fetches every crop for an "all" export', async () => {
      const view = setup();

      await act(async () => { await view.result.current.handleExport('all', 'json'); });

      expect(api.listAll).toHaveBeenCalled();
      expect(json.downloadJson).toHaveBeenCalledWith({ crops: [CROP] }, 'all.json');
    });

    it('falls back to fetching everything when "current" has no crop selected', async () => {
      const view = setup(null);

      await act(async () => { await view.result.current.handleExport('current', 'json'); });

      expect(api.listAll).toHaveBeenCalled();
    });

    it('writes a spreadsheet for a spreadsheet format', async () => {
      const view = setup();

      await act(async () => { await view.result.current.handleExport('current', 'xlsx'); });

      expect(spreadsheet.exportToSpreadsheet).toHaveBeenCalled();
      expect(json.downloadJson).not.toHaveBeenCalled();
    });

    it('reports a failure rather than leaving the user guessing', async () => {
      api.listAll.mockRejectedValue(new Error('boom'));
      const view = setup();

      await act(async () => { await view.result.current.handleExport('all', 'json'); });

      expect(view.showSnackbar).toHaveBeenCalledWith(expect.any(String), 'error');
    });
  });

  describe('dialogs', () => {
    it('opens the start dialog on the import trigger', () => {
      const view = setup();

      act(() => { view.result.current.handleImportFileTrigger(); });

      expect(view.result.current.importStartDialogOpen).toBe(true);
    });

    it('opens the export dialog scoped to the current crop', () => {
      const view = setup();

      act(() => { view.result.current.handleExportCurrentCrop(); });

      expect(view.result.current.exportDialogOpen).toBe(true);
      expect(view.result.current.exportDialogInitialScope).toBe('current');
    });

    it('opens the export dialog scoped to everything', () => {
      const view = setup();

      act(() => { view.result.current.handleExportAllCrops(); });

      expect(view.result.current.exportDialogInitialScope).toBe('all');
    });
  });
});
