import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { loadVarietyImportPreviews } from '../crop-library/importVarietyPreviews';
import { PublicCropVarietyImportDialog } from '../crop-library/components/PublicCropVarietyImportDialog';
import type { PublicCrop } from '../api/types';
import i18n from '../i18n';

const { list, preview, commit, sync, link } = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), commit: vi.fn(), sync: vi.fn(), link: vi.fn() }));
vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return { ...actual,
    plantFamilyAPI: { list: vi.fn().mockResolvedValue({ data: [] }) },
    publicCropAPI: { ...actual.publicCropAPI, listAll: list, importPreview: preview, importSelection: commit },
    cropAPI: { ...actual.cropAPI, publicSyncPreview: sync, linkPublicCrop: link },
  };
});
const t = i18n.getFixedT('de', 'crops');
const parent = { id: 1, name: 'Carrot', variety: '', crop_species: 77, version: 3 } as PublicCrop;
const varieties = ['Nantaise 2', 'Nantaise 2/Milan', 'Rodelika'].map((variety, index) => ({ ...parent, id: index + 2, variety }));
const decision = (entry: PublicCrop) => ({ public_crop_id: entry.id, base_version: entry.version, link_to_library: true });
function setup(entry = parent) {
  const onClose = vi.fn(); const onComplete = vi.fn().mockResolvedValue(undefined); const onWithoutVarieties = vi.fn();
  const rendered = render(<MemoryRouter><PublicCropVarietyImportDialog parent={entry} onClose={onClose}
    onComplete={onComplete} onWithoutVarieties={onWithoutVarieties} /></MemoryRouter>);
  return { onClose, onComplete, onWithoutVarieties, unmount: rendered.unmount };
}
async function submit(count = 3, linked = false) {
  fireEvent.click(await screen.findByRole('button', { name: t(linked ? 'library.varietyImport.importVarieties' : count ? 'library.varietyImport.importWithVarieties' : 'library.varietyImport.importParent', { count }) }));
}
describe('selected library variety import', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.setItem('activeProjectId', '42');
    list.mockResolvedValue({ results: [parent, ...varieties] });
    preview.mockResolvedValue({ data: { candidates: [] } });
    commit.mockResolvedValue({ data: { entries: [parent, ...varieties].map(entry => ({ public_crop_id: entry.id, crop_id: entry.id + 10, operation: 'created' })) } });
    sync.mockResolvedValue({ data: { public_version: 3, crop_updated_at: '2026-11-15T12:00:00Z', changes: [
      { field: 'notes', local_value: 'Private notes', public_value: '', pushable: true, pinnable: true },
    ] } });
  });
  it('preselects all varieties and commits one linked scope, with no writes during selection', async () => {
    const { onComplete } = setup();
    expect(await screen.findByRole('checkbox', { name: 'Rodelika' })).toBeChecked();
    expect(commit).not.toHaveBeenCalled();
    await submit();
    await waitFor(() => expect(commit).toHaveBeenCalledWith(1, { expected_project_id: 42,
      decisions: [parent, ...varieties].map(decision), accepted_public_library_terms: false }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  it('supports a subset, indeterminate select-all and parent only', async () => {
    setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Rodelika' }));
    expect(screen.getByRole('checkbox', { name: t('library.varietyImport.selectAll', { count: 3 }) })).toHaveAttribute('data-indeterminate', 'true');
    await submit(2);
    await waitFor(() => expect(commit).toHaveBeenCalledWith(1, expect.objectContaining({ decisions: [parent, ...varieties.slice(0, 2)].map(decision) })));
  });
  it('explains the 500-variety limit before any preview and accepts the exact boundary', async () => {
    const many = Array.from({ length: 501 }, (_, index) => ({ ...parent, id: index + 2, variety: `Selection ${index + 1}` }));
    list.mockResolvedValue({ results: [parent, ...many] });
    setup();
    const submit = await screen.findByRole('button', { name: t('library.varietyImport.importWithVarieties', { count: 501 }) });
    expect(submit).toBeDisabled();
    expect(screen.getByText(t('library.varietyImport.selectionLimit', { limit: 500 }))).toBeVisible();
    fireEvent.click(submit);
    expect(preview).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selection 501', exact: true }));
    expect(screen.getByRole('button', { name: t('library.varietyImport.importWithVarieties', { count: 500 }) })).toBeEnabled();
  });
  it('clearing all imports only the parent', async () => {
    setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: t('library.varietyImport.selectAll', { count: 3 }) }));
    await submit(0);
    await waitFor(() => expect(commit).toHaveBeenCalledWith(1, expect.objectContaining({ decisions: [decision(parent)] })));
  });
  it('adds missing varieties without selecting already linked ones', async () => {
    list.mockResolvedValue({ results: [{ ...parent, project_import_status: { crop_id: 11 } },
      { ...varieties[0], project_import_status: { crop_id: 12 } }, ...varieties.slice(1)] });
    setup();
    expect(await screen.findByRole('checkbox', { name: /Nantaise 2 ·/ })).toBeDisabled();
    expect(screen.getByText(t('library.varietyImport.parentLinked'))).toBeVisible();
    await submit(2, true);
    await waitFor(() => expect(commit).toHaveBeenCalledWith(1, expect.objectContaining({ decisions: [parent, ...varieties.slice(1)].map(decision) })));
    expect(preview).not.toHaveBeenCalledWith(parent.id);
  });
  it('keeps direct import for a culture without varieties', async () => {
    list.mockResolvedValue({ results: [parent] });
    const { onWithoutVarieties } = setup();
    await waitFor(() => expect(onWithoutVarieties).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(commit).not.toHaveBeenCalled();
  });
  it('canceling a comparison commits none of the new parent or varieties', async () => {
    preview.mockImplementation(async (id: number) => ({ data: { candidates: id === 4 ? [
      { id: 99, name: 'Carrot', variety: 'Rodelika', species_match: true, source_public_crop: null },
    ] : [] } }));
    const { onClose } = setup();
    await submit();
    await screen.findByText(t('library.importDecision.existing'));
    fireEvent.click(screen.getByRole('button', { name: i18n.getFixedT('de', 'common')('actions.cancel') }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
  });
  it('stages private field decisions and commits them with every selected entry', async () => {
    preview.mockImplementation(async (id: number) => ({ data: { candidates: id === 4 ? [
      { id: 99, name: 'Carrot', variety: 'Rodelika', species_match: true, source_public_crop: null },
    ] : [] } }));
    setup(); await submit();
    const next = await screen.findByRole('button', { name: t('library.varietyImport.continue') });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await waitFor(() => expect(commit).toHaveBeenCalledWith(1, expect.objectContaining({ decisions: [
      ...[parent, ...varieties.slice(0, 2)].map(decision), { ...decision(varieties[2]),
        target_id: 99, expected_updated_at: '2026-11-15T12:00:00Z', pull_fields: [], pin_fields: ['notes'], push_fields: [] },
    ] })));
    expect(link).not.toHaveBeenCalled();
  });
  it('reuses prepared previews when multiple existing comparisons are confirmed', async () => {
    preview.mockImplementation(async (id: number) => ({ data: { candidates: id === 1 || id === 4 ? [
      { id: id + 90, name: 'Carrot', variety: id === 4 ? 'Rodelika' : '', species_match: true, source_public_crop: null },
    ] : [] } }));
    setup(); await submit();
    for (let index = 0; index < 2; index++) {
      const next = await screen.findByRole('button', { name: t('library.varietyImport.continue') });
      await waitFor(() => expect(next).toBeEnabled());
      fireEvent.click(next);
      if (index === 0) await waitFor(() => expect(sync).toHaveBeenCalledWith(94, 4));
    }
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(preview).toHaveBeenCalledTimes(4);
    expect(link).not.toHaveBeenCalled();
  });
  it('does not commit if navigation closes the selection while previews are loading', async () => {
    const pending: (() => void)[] = [];
    preview.mockImplementation(() => new Promise(resolve => {
      pending.push(() => resolve({ data: { candidates: [] } }));
    }));
    const { unmount, onComplete } = setup();
    await submit();
    expect(preview).toHaveBeenCalledTimes(4);
    unmount();
    await act(async () => { pending.forEach(resolve => resolve()); });
    expect(commit).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
  });
  it.each([false, true])('keeps completion tied to its own dialog when navigation closes it: %s', async closed => {
    let finish!: () => void;
    const onComplete = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    const rendered = render(<MemoryRouter><PublicCropVarietyImportDialog parent={parent} onClose={onClose}
      onComplete={onComplete} onWithoutVarieties={vi.fn()} /></MemoryRouter>);
    await submit();
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t('library.varietyImport.importWithVarieties', { count: 3 }) })).toBeDisabled();
    if (closed) rendered.unmount();
    await act(async () => { finish(); });
    expect(onClose).toHaveBeenCalledTimes(closed ? 0 : 1);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('retains selection after an atomic failure and retries the scope once', async () => {
    commit.mockRejectedValueOnce(new Error('Synthetic rollback'));
    setup(); await submit();
    expect(await screen.findByText(t('library.varietyImport.failed'))).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Rodelika' })).toBeChecked();
    await submit(); await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
  });
  it('blocks a project switch before submitting any selection', async () => {
    setup(); await screen.findByRole('checkbox', { name: 'Rodelika' });
    localStorage.setItem('activeProjectId', '43'); await submit();
    expect(await screen.findByText(t('library.importProjectChanged'))).toBeVisible();
    expect(commit).not.toHaveBeenCalled();
  });
});


describe('bounded variety preview requests', () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({ ...parent, id: index + 1 }));
  beforeEach(() => { vi.clearAllMocks(); });

  it('loads concurrently with at most eight requests and retains input order', async () => {
    const pending: (() => void)[] = [];
    let active = 0; let peak = 0;
    preview.mockImplementation((id: number) => new Promise(resolve => {
      active++; peak = Math.max(peak, active);
      pending.push(() => { active--; resolve({ data: { candidates: [{ id, name: `Local ${id}` }] } }); });
    }));
    const progress = vi.fn();
    const result = loadVarietyImportPreviews(entries, () => undefined, progress);
    expect(preview).toHaveBeenCalledTimes(8);
    pending.splice(0).forEach(resolve => resolve());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(16));
    pending.splice(0).forEach(resolve => resolve());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(20));
    pending.splice(0).forEach(resolve => resolve());
    const previews = await result;
    expect(peak).toBe(8); expect(active).toBe(0);
    expect([...previews.keys()]).toEqual(entries.map(entry => entry.id));
    expect(progress.mock.calls.map(([completed]) => completed)).toEqual([8, 16, 20]);
  });

  it('drains an unsuccessful batch before permitting another attempt and starts no later batch', async () => {
    const pending: (() => void)[] = [];
    const failure = new Error('Synthetic preview failure');
    preview.mockImplementation((id: number) => new Promise((resolve, reject) => {
      pending.push(() => id === 1 ? reject(failure) : resolve({ data: { candidates: [] } }));
    }));
    let settled = false;
    const result = loadVarietyImportPreviews(entries, () => undefined, () => undefined)
      .catch(error => error).finally(() => { settled = true; });
    pending.shift()!();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(preview).toHaveBeenCalledTimes(8);
    pending.splice(0).forEach(resolve => resolve());
    expect(await result).toBe(failure);
    expect(settled).toBe(true); expect(preview).toHaveBeenCalledTimes(8);
  });

  it('stops before the next batch if the active project changes', async () => {
    preview.mockResolvedValue({ data: { candidates: [] } });
    let current = true;
    const result = loadVarietyImportPreviews(entries, () => {
      if (!current) throw new Error('Project changed');
    }, () => { current = false; });
    await expect(result).rejects.toThrow('Project changed');
    expect(preview).toHaveBeenCalledTimes(8);
  });

  it('skips preview requests for already linked entries', async () => {
    preview.mockResolvedValue({ data: { candidates: [] } });
    const linked = { ...parent, project_import_status: { crop_id: 99 } } as PublicCrop;
    const result = await loadVarietyImportPreviews([linked, ...varieties], () => undefined, () => undefined);
    expect(preview).toHaveBeenCalledTimes(3); expect(preview).not.toHaveBeenCalledWith(parent.id);
    expect(result.get(parent.id)).toEqual([]);
  });
});
