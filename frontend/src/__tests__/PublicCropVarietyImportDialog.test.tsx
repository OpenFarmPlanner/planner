import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
  render(<MemoryRouter><PublicCropVarietyImportDialog parent={entry} onClose={onClose}
    onComplete={onComplete} onWithoutVarieties={onWithoutVarieties} /></MemoryRouter>);
  return { onClose, onComplete, onWithoutVarieties };
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
