import { act, renderHook } from '@testing-library/react';
import { useNotesEditor } from '../components/data-grid/useNotesEditor';

interface TestRow {
  id: number;
  notes?: string;
  description?: string;
  [key: string]: unknown;
}

const rows: TestRow[] = [
  { id: 1, notes: 'first note', description: 'first description' },
  { id: 2, notes: '', description: 'second description' },
];

function setup(overrides: {
  onSave?: (options: { row: TestRow; field: string; value: string }) => Promise<void>;
  onError?: (message: string) => void;
} = {}) {
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onError = overrides.onError ?? vi.fn();
  const view = renderHook(() => useNotesEditor<TestRow>({ rows, onSave, onError }));
  return { ...view, onSave, onError };
}

describe('useNotesEditor', () => {
  it('opens with the current value of the requested field', () => {
    const { result } = setup();

    act(() => { result.current.handleOpen(1, 'description'); });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.currentRow).toEqual(rows[0]);
    expect(result.current.field).toBe('description');
    expect(result.current.draft).toBe('first description');
  });

  it('ignores an unknown row id', () => {
    const { result } = setup();

    act(() => { result.current.handleOpen(99, 'notes'); });

    expect(result.current.isOpen).toBe(false);
  });

  it('requests a fresh focus token on every open so the drawer re-focuses', () => {
    const { result } = setup();

    act(() => { result.current.handleOpen(1, 'notes', { focusAttachments: true }); });
    const firstRequest = result.current.focusRequestId;
    expect(result.current.focusAttachments).toBe(true);

    act(() => { result.current.handleClose(); });
    act(() => { result.current.handleOpen(1, 'notes', { focusAttachments: true }); });

    expect(result.current.focusRequestId).toBeGreaterThan(firstRequest);
  });

  it('re-requests focus without reloading the draft when the same cell is reopened', () => {
    const { result } = setup();

    act(() => { result.current.handleOpen(1, 'notes'); });
    act(() => { result.current.setDraft('edited but not saved'); });
    const requestBeforeReopen = result.current.focusRequestId;

    act(() => { result.current.handleOpen(1, 'notes', { focusAttachments: true }); });

    expect(result.current.draft).toBe('edited but not saved');
    expect(result.current.focusAttachments).toBe(true);
    expect(result.current.focusRequestId).toBeGreaterThan(requestBeforeReopen);
  });

  it('saves the draft and closes', async () => {
    const { result, onSave } = setup();

    act(() => { result.current.handleOpen(2, 'notes'); });
    act(() => { result.current.setDraft('a new note'); });
    await act(async () => { await result.current.handleSave(); });

    expect(onSave).toHaveBeenCalledWith({ row: rows[1], field: 'notes', value: 'a new note' });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.draft).toBe('');
    expect(result.current.isSaving).toBe(false);
  });

  it('keeps the drawer open with the draft intact when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Speichern fehlgeschlagen'));
    const { result, onError } = setup({ onSave });

    act(() => { result.current.handleOpen(1, 'notes'); });
    act(() => { result.current.setDraft('unsaved edit'); });
    await act(async () => { await result.current.handleSave(); });

    expect(onError).toHaveBeenCalledWith('Speichern fehlgeschlagen');
    expect(result.current.isOpen).toBe(true);
    expect(result.current.draft).toBe('unsaved edit');
    expect(result.current.isSaving).toBe(false);
  });

  it('discards the draft on close without saving', () => {
    const { result, onSave } = setup();

    act(() => { result.current.handleOpen(1, 'notes'); });
    act(() => { result.current.setDraft('discarded'); });
    act(() => { result.current.handleClose(); });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.currentRow).toBeNull();
    expect(result.current.draft).toBe('');
  });
});
