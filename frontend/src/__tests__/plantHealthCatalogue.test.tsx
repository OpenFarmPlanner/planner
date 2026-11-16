import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import { plantHealthAPI } from '../crop-library/plant-health/api';
import { EntryDialog } from '../crop-library/plant-health/EntryDialog';
import { PlantHealthCataloguePanel } from '../crop-library/plant-health/PlantHealthCataloguePanel';
import { HostDialog } from '../crop-library/plant-health/HostDialog';
import { createNameDrafts, sourcePayload, translationPayload } from '../crop-library/plant-health/drafts';
import type { PlantHealthEntry, PlantHealthHost } from '../crop-library/plant-health/types';

vi.mock('../crop-library/plant-health/api', () => ({ plantHealthAPI: {
  create: vi.fn(), update: vi.fn(), approve: vi.fn(), saveHost: vi.fn(), list: vi.fn(), history: vi.fn(), review: vi.fn(),
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
  it('can omit an optional language after disabling its scientific fallback', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    vi.mocked(plantHealthAPI.create).mockResolvedValue({ data: entry() } as never);
    render(<EntryDialog mode="create" {...actions} />);
    await user.type(screen.getByRole('textbox', { name: 'Name (English)' }), 'Primary name');
    await user.type(screen.getByRole('textbox', { name: 'Scientific name' }), 'Syntheticus example');
    const language = screen.getByRole('button', { name: 'Français', exact: true });
    await user.click(language);
    const fields = within(language.closest('.MuiAccordion-root') as HTMLElement);
    await user.click(fields.getByRole('checkbox'));
    await user.type(fields.getByRole('textbox', { name: 'Reason for the scientific-name fallback' }), 'Synthetic fallback reason.');
    await user.click(fields.getByRole('checkbox'));
    await user.clear(fields.getByRole('textbox', { name: 'Name (French)' }));
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(actions.onSaved).toHaveBeenCalledOnce());
    expect(plantHealthAPI.create).toHaveBeenCalledWith(expect.objectContaining({
      translations: [expect.objectContaining({ language_code: 'en', preferred_name: 'Primary name' })],
    }));
  });
  it('does not submit an incomplete approval', async () => {
    const user = userEvent.setup();
    render(<EntryDialog entry={entry({ translations: [{ language_code: 'en', preferred_name: 'Only English' }] })} mode="approve" {...callbacks()} />);
    await user.click(screen.getByRole('button', { name: 'Approve', exact: true }));
    expect(plantHealthAPI.approve).not.toHaveBeenCalled();
    const error = screen.getByText(/The change could not be saved/).closest('[role="alert"]');
    expect(error).toHaveFocus();
    expect(error).toHaveAccessibleDescription(i18n.t('crops:plantHealthCatalogue.approvalHint'));
    await user.click(screen.getByRole('button', { name: 'Approve', exact: true }));
    expect(error).toHaveFocus();
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
    expect(screen.getByText(/The change could not be saved/).closest('[role="alert"]')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(plantHealthAPI.update).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/The change could not be saved/).closest('[role="alert"]')).toHaveFocus());
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
  it('reveals repeated validation failures without discarding host input', async () => {
    const user = userEvent.setup();
    render(<HostDialog entry={entry()} {...callbacks()} />);
    await user.type(screen.getByRole('textbox', { name: i18n.t('crops:plantHealthCatalogue.variety') }), 'Preserved variety');
    for (let attempt = 0; attempt < 2; attempt++) {
      await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
      const error = screen.getByText(i18n.t('crops:plantHealthCatalogue.hostError')).closest('[role="alert"]');
      expect(error).toHaveFocus();
      expect(error).toHaveAccessibleDescription(i18n.t('crops:plantHealthCatalogue.hostDisclaimer'));
      expect(screen.getByRole('textbox', { name: i18n.t('crops:plantHealthCatalogue.variety') })).toHaveValue('Preserved variety');
    }
    expect(plantHealthAPI.saveHost).not.toHaveBeenCalled();
  });

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


it('shows public, anonymous and deleted actors in the moderator history', async () => {
  const user = userEvent.setup();
  vi.mocked(plantHealthAPI.list).mockResolvedValue({ data: { count: 1, results: [entry()] } } as never);
  vi.mocked(plantHealthAPI.history).mockResolvedValue({ data: [
    { id: 1, action: 'update', actor_label: 'Public curator', actor_anonymous_number: null,
      created_at: '2026-11-15T02:00:00Z', snapshot: entry() },
    { id: 2, action: 'update', actor_label: '', actor_anonymous_number: 2,
      created_at: '2026-11-15T02:00:01Z', snapshot: entry() },
    { id: 3, action: 'update', actor_label: '', actor_anonymous_number: null,
      created_at: '2026-11-15T02:00:02Z', snapshot: entry() },
  ] } as never);
  render(<PlantHealthCataloguePanel />);
  await user.click(await screen.findByRole('button', { name: i18n.t('crops:plantHealthCatalogue.history'), exact: true }));
  const dialog = await screen.findByRole('dialog', { name: i18n.t('crops:plantHealthCatalogue.history') });
  expect(within(dialog).getByText('Public curator')).toBeInTheDocument();
  expect(within(dialog).getByText('Anonymous 2')).toBeInTheDocument();
  expect(within(dialog).getByText('Unknown user')).toBeInTheDocument();
});


describe('catalogue moderation pagination', () => {
  it.each(['approve', 'reject', 'archive'] as const)('returns to matching results after %s removes the last row on page two', async action => {
    const user = userEvent.setup();
    let changed = false;
    const first = entry({ id: 1, display_name: 'Synthetic first-page result' });
    const last = entry({ id: 21, display_name: 'Synthetic final proposal' });
    vi.mocked(plantHealthAPI.list).mockImplementation(async params => ({ data: {
      count: changed ? 20 : 21,
      results: params.page === 2 ? changed ? [] : [last] : [first],
    } }) as never);
    vi.mocked(plantHealthAPI.approve).mockImplementation(async () => {
      changed = true; return { data: last } as never;
    });
    vi.mocked(plantHealthAPI.review).mockImplementation(async () => {
      changed = true; return { data: last } as never;
    });
    render(<PlantHealthCataloguePanel />);
    await screen.findByRole('article', { name: first.display_name });
    await user.type(screen.getByRole('textbox', { name: i18n.t('crops:plantHealthCatalogue.search') }), 'Synthetic');
    await waitFor(() => expect(plantHealthAPI.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'Synthetic', page: 1 }), expect.any(AbortSignal)));
    await user.click(await screen.findByRole('button', { name: 'Go to page 2' }));
    const card = await screen.findByRole('article', { name: last.display_name });
    const openAction = action === 'approve' ? 'review' : action;
    await user.click(within(card).getByRole('button', { name: i18n.t(`crops:plantHealthCatalogue.${openAction}`), exact: true }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: i18n.t(`crops:plantHealthCatalogue.${action}`), exact: true }));
    await screen.findByRole('article', { name: first.display_name });
    expect(plantHealthAPI.list).toHaveBeenLastCalledWith(expect.objectContaining({
      q: 'Synthetic', status: 'proposed', page: 1,
    }), expect.any(AbortSignal));
    expect(screen.queryByRole('article', { name: last.display_name })).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t('crops:plantHealthCatalogue.empty'))).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
