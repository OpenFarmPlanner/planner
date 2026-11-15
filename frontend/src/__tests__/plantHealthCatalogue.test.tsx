import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import { plantHealthAPI } from '../crop-library/plant-health/api';
import { EntryDialog } from '../crop-library/plant-health/EntryDialog';
import { HostDialog } from '../crop-library/plant-health/HostDialog';
import { createNameDrafts, sourcePayload, translationPayload } from '../crop-library/plant-health/drafts';
import type { PlantHealthEntry, PlantHealthHost } from '../crop-library/plant-health/types';

vi.mock('../crop-library/plant-health/api', () => ({ plantHealthAPI: {
  create: vi.fn(), update: vi.fn(), approve: vi.fn(), saveHost: vi.fn(),
} }));
const entry = (overrides: Partial<PlantHealthEntry> = {}): PlantHealthEntry => ({
  id: 14, identity_key: 'synthetic-identity', name: 'Synthetic reference', scientific_name: 'Syntheticus example', kind: 'pathogen', eppo_code: '',
  sources: [{ url: 'https://example.org/synthetic-study' }], status: 'proposed', reviewed_at: null, review_note: '',
  translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, preferred_name: `Name ${code}`,
    synonyms: ['Preserved alias'], regional_names: { BE: 'Preserved regional label' } })),
  display_name: 'Synthetic reference', display_language_code: 'en', has_specific_identity: true, hosts: [], ...overrides,
});
const callbacks = () => ({ onSaved: vi.fn().mockResolvedValue(undefined), onClose: vi.fn() });
beforeEach(async () => { vi.resetAllMocks(); await i18n.changeLanguage('en'); });

describe('catalogue payload boundaries', () => {
  it('keeps aliases and untouched languages when one preferred name changes', () => {
    const drafts = createNameDrafts(entry().translations);
    drafts.en = { ...drafts.en, preferred_name: 'A revised name' };
    const payload = translationPayload(drafts)!;
    expect(payload.find(row => row.language_code === 'en')).toMatchObject({ preferred_name: 'A revised name', synonyms: ['Preserved alias'], regional_names: { BE: 'Preserved regional label' } });
    expect(payload.find(row => row.language_code === 'nl')?.preferred_name).toBe('Name nl');
  });
  it('rejects incomplete regional names and undocumented scientific fallbacks', () => {
    const drafts = createNameDrafts(entry().translations);
    drafts.en.regional_names = { B: 'Incomplete country code' };
    expect(translationPayload(drafts)).toBeNull();
    drafts.en.regional_names = {};
    drafts.en.is_scientific_fallback = true;
    expect(translationPayload(drafts)).toBeNull();
  });
  it('never silently drops aliases entered without a preferred name', () => {
    const drafts = createNameDrafts([]);
    drafts.en.synonyms = ['An alias without its name'];
    expect(translationPayload(drafts)).toBeNull();
  });
  it('drops only wholly empty source rows and rejects credentials or unsafe schemes', () => {
    expect(sourcePayload([{ url: '' }, { url: 'https://example.org/evidence', title: 'Kept' }])).toEqual([{ url: 'https://example.org/evidence', title: 'Kept' }]);
    for (const url of ['javascript:alert(1)', 'file:///tmp/private', 'https://user:password@example.org']) expect(sourcePayload([{ url }])).toBeNull();
    expect(sourcePayload([{ url: '', evidence: 'Must not disappear' }])).toBeNull();
  });
});

describe('catalogue entry editor', () => {
  it('proposes with one language and leaves moderation to a separate action', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    vi.mocked(plantHealthAPI.create).mockResolvedValue({ data: entry() } as never);
    render(<EntryDialog mode="create" {...actions} />);
    await user.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'A synthetic pest');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(actions.onClose).toHaveBeenCalledOnce());
    expect(plantHealthAPI.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'A synthetic pest', kind: 'group', sources: [], translations: [expect.objectContaining({ language_code: 'en', preferred_name: 'A synthetic pest' })] }));
    expect(plantHealthAPI.approve).not.toHaveBeenCalled();
  });
  it('does not submit an incomplete approval', async () => {
    const user = userEvent.setup();
    render(<EntryDialog entry={entry({ translations: [{ language_code: 'en', preferred_name: 'Only English' }] })} mode="approve" {...callbacks()} />);
    await user.click(screen.getByRole('button', { name: 'Approve', exact: true }));
    expect(plantHealthAPI.approve).not.toHaveBeenCalled();
    expect(screen.getByText(/The change could not be saved/)).toBeVisible();
  });
  it('approves complete names without discarding aliases, regions or sources', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    vi.mocked(plantHealthAPI.approve).mockResolvedValue({ data: entry({ status: 'published' }) } as never);
    render(<EntryDialog entry={entry()} mode="approve" {...actions} />);
    await user.clear(screen.getByRole('textbox', { name: 'Name (English)' }));
    await user.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Reviewed English name');
    await user.click(screen.getByRole('button', { name: 'Approve', exact: true }));
    await waitFor(() => expect(actions.onClose).toHaveBeenCalledOnce());
    expect(plantHealthAPI.approve).toHaveBeenCalledWith(14, expect.objectContaining({ sources: [{ url: 'https://example.org/synthetic-study' }], translations: expect.arrayContaining([expect.objectContaining({ language_code: 'en', synonyms: ['Preserved alias'], regional_names: { BE: 'Preserved regional label' } }), expect.objectContaining({ language_code: 'nl', preferred_name: 'Name nl' })]) }));
  });
  it('does not silently ignore clearing an existing name', async () => {
    const user = userEvent.setup();
    render(<EntryDialog entry={entry()} mode="edit" {...callbacks()} />);
    await user.clear(screen.getByRole('textbox', { name: 'Name (English)' }));
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(plantHealthAPI.update).not.toHaveBeenCalled();
    expect(screen.getByText(/The change could not be saved/)).toBeVisible();
  });
  it('keeps the draft open after a failed save', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    vi.mocked(plantHealthAPI.update).mockRejectedValue(new Error('Synthetic failure'));
    render(<EntryDialog entry={entry()} mode="edit" {...actions} />);
    await user.type(screen.getByRole('textbox', { name: 'Name (English)' }), ' retained');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await screen.findByText(/The change could not be saved/);
    expect(screen.getByRole('textbox', { name: 'Name (English)' })).toHaveValue('Name en retained');
    expect(actions.onClose).not.toHaveBeenCalled();
  });
  it('confirms discarding edits without writing', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(<EntryDialog entry={entry()} mode="edit" {...actions} />);
    await user.type(screen.getByRole('textbox', { name: 'Name (English)' }), ' changed');
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(actions.onClose).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('dialog', { name: i18n.t('crops:form.discardChangesTitle') });
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('crops:form.discardConfirm') }));
    expect(actions.onClose).toHaveBeenCalledOnce();
    expect(plantHealthAPI.update).not.toHaveBeenCalled();
  });
  it('allows a documented scientific fallback and keeps it aligned with the scientific name', async () => {
    const user = userEvent.setup();
    const original = entry();
    original.translations.find(row => row.language_code === 'en')!.is_scientific_fallback = true;
    original.translations.find(row => row.language_code === 'en')!.fallback_reason = 'No established name in the synthetic fixture.';
    original.translations.find(row => row.language_code === 'en')!.preferred_name = 'Syntheticus example';
    vi.mocked(plantHealthAPI.update).mockResolvedValue({ data: original } as never);
    render(<EntryDialog entry={original} mode="edit" {...callbacks()} />);
    const scientific = screen.getByRole('textbox', { name: 'Scientific name' });
    fireEvent.change(scientific, { target: { value: 'Syntheticus revised' } });
    expect(screen.getByRole('textbox', { name: 'Name (English)' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Name (English)' })).toHaveValue('Syntheticus revised');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(plantHealthAPI.update).toHaveBeenCalled());
    expect(plantHealthAPI.update).toHaveBeenCalledWith(14, expect.objectContaining({ translations: expect.arrayContaining([expect.objectContaining({ language_code: 'en', preferred_name: 'Syntheticus revised', is_scientific_fallback: true })]) }));
  });
});

describe('host editor', () => {
  it('cannot turn a broad concept into a confirmed pathogen relationship', async () => {
    const user = userEvent.setup();
    const host: PlantHealthHost = { id: 3, entry: 14, species: 7, species_name: 'Synthetic crop', variety_name: 'Variety A', qualification: 'Preserved qualification', sources: [{ url: 'https://example.org/host' }], is_confirmed: false, is_active: true };
    vi.mocked(plantHealthAPI.saveHost).mockResolvedValue({ data: host } as never);
    render(<HostDialog entry={entry({ kind: 'group', has_specific_identity: false })} host={host} {...callbacks()} />);
    expect(screen.getByRole('checkbox', { name: 'Confirmed host plant' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(plantHealthAPI.saveHost).toHaveBeenCalled());
    expect(plantHealthAPI.saveHost).toHaveBeenCalledWith(expect.objectContaining({ is_confirmed: false, qualification: 'Preserved qualification', variety_name: 'Variety A' }), 3);
  });
});
