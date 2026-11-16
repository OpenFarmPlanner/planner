import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import type { Crop, PlantHealthSelections } from '../api/types';
import type { PlantHealthEntry } from '../crop-library/plant-health/types';
import { PlantHealthField } from '../crops/sections/PlantHealthField';
import { planLibraryLink, pickLibraryChoices } from '../crops/libraryLink';
import { PlantHealthPublicationPanel } from '../crops/PlantHealthPublicationPanel';
import { PlantHealthChips } from '../crops/PlantHealthChips';
import { normalizePlantHealthSelections, collectLocalPlantHealth } from '../crops/plantHealth';
import i18n from '../i18n/config';

const { listMock, createMock, mapMock } = vi.hoisted(() => ({ listMock: vi.fn(), createMock: vi.fn(), mapMock: vi.fn() }));
vi.mock('../crop-library/plant-health/api', () => ({ plantHealthAPI: { list: listMock, create: createMock } }));
vi.mock('../api/api', () => ({ cropAPI: { mapPlantHealth: mapMock } }));
const ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const catalogueEntry = (identity = ID, display_name = 'Bevorzugter Name'): PlantHealthEntry => ({
  id: 1, identity_key: identity, name: 'Canonical name', display_name,
  display_language_code: 'de', scientific_name: 'Syntheticus example', kind: 'pathogen',
  eppo_code: '', status: 'published', sources: [], translations: [], hosts: [],
  reviewed_at: null, review_note: '', has_specific_identity: true,
});
const response = (...entries: PlantHealthEntry[]) => ({ data: { results: entries } });

beforeEach(async () => {
  await i18n.changeLanguage('de');
  listMock.mockReset();
  createMock.mockReset();
  mapMock.mockReset();
  listMock.mockResolvedValue(response());
});

describe('private plant-health selections', () => {
  it('keeps accents, delimiters, local names and separate official identities distinct', () => {
    expect(normalizePlantHealthSelections([
      ' Spot;  A, B ', 'spot; a, b', 'é', 'e',
      { name: 'Spot; A, B', catalogue_identity: ID },
      { name: 'Spot; A, B', catalogue_identity: OTHER_ID },
    ])).toHaveLength(5);
    expect(collectLocalPlantHealth([
      { plant_health: { entries: [{ name: 'Private name' }, { name: 'Official', catalogue_identity: ID }] } },
    ])).toEqual([{ name: 'Private name' }]);
  });

  it('does not turn typed matching catalogue text into an official reference', async () => {
    listMock.mockResolvedValue(response(catalogueEntry()));
    const change = vi.fn();
    const user = userEvent.setup();
    render(<PlantHealthField value={null} localOptions={[]} onChange={change} canInherit={false} />);
    const input = screen.getByRole('combobox', { name: 'Schädlings- und Krankheitseinträge' });
    await user.type(input, 'Bevorzugter Name');
    await screen.findByRole('option', { name: /^Bevorzugter Name/ });
    await user.keyboard('{Enter}');
    expect(change).toHaveBeenLastCalledWith({ entries: [{ name: 'Bevorzugter Name' }] });
  });

  it('offers a catalogue result matched by a synonym and requires explicit selection', async () => {
    listMock.mockResolvedValue(response(catalogueEntry()));
    const change = vi.fn();
    const user = userEvent.setup();
    render(<PlantHealthField value={null} localOptions={[]} onChange={change} canInherit={false} />);
    await user.type(screen.getByRole('combobox', { name: 'Schädlings- und Krankheitseinträge' }), 'Synonym');
    await user.click(await screen.findByRole('option', { name: /^Bevorzugter Name/ }));
    expect(change).toHaveBeenLastCalledWith({ entries: [{ name: 'Canonical name', catalogue_identity: ID }] });
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ q: 'Synonym', status: 'published' }), expect.any(AbortSignal));
  });

  it('commits an unfinished private name on blur', async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<><PlantHealthField value={null} localOptions={[{ name: 'Known spelling' }]} onChange={change} canInherit={false} /><button>Outside</button></>);
    await user.type(screen.getByRole('combobox', { name: 'Schädlings- und Krankheitseinträge' }), 'known  SPELLING');
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(change).toHaveBeenLastCalledWith({ entries: [{ name: 'Known spelling' }] });
  });

  it('clears a prefilled inherited list explicitly and can return to live inheritance', async () => {
    const change = vi.fn();
    const parent = { entries: [{ name: 'Parent entry' }] };
    function Form() {
      const [value, setValue] = useState<PlantHealthSelections | null>(parent);
      return <PlantHealthField value={value} inheritedValue={parent} localOptions={[]} canInherit
        onChange={next => { change(next); setValue(next); }} />;
    }
    const user = userEvent.setup();
    render(<Form />);
    await user.click(screen.getByRole('button', { name: 'Parent entry · Privater Name' }));
    await user.keyboard('{Backspace}');
    expect(change).toHaveBeenLastCalledWith({ entries: [] });
    expect(screen.queryByText('Parent entry · Privater Name')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Einträge der Kultur verwenden' }));
    expect(change).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Parent entry · Privater Name')).toBeInTheDocument();
  });

  it('ignores a stale translated-identity response after another crop is selected', async () => {
    let release: (value: ReturnType<typeof response>) => void = () => {};
    listMock.mockImplementation(({ identities }) => identities === ID
      ? new Promise(resolve => { release = resolve; })
      : Promise.resolve(response(catalogueEntry(OTHER_ID, 'Aktueller Name'))));
    const view = render(<PlantHealthChips value={{ entries: [{ name: 'Old snapshot', catalogue_identity: ID }] }} />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    view.rerender(<PlantHealthChips value={{ entries: [{ name: 'Current snapshot', catalogue_identity: OTHER_ID }] }} />);
    await screen.findByText('Aktueller Name · Katalogeintrag');
    await act(async () => release(response(catalogueEntry(ID, 'Veralteter Name'))));
    expect(screen.getByText('Aktueller Name · Katalogeintrag')).toBeInTheDocument();
    expect(screen.queryByText(/Veralteter Name/)).not.toBeInTheDocument();
  });
});


describe('explicit publication mappings', () => {
  const crop = { id: 12, name: 'Synthetic culture', updated_at: '2026-11-16T01:00:00Z',
    plant_health: { entries: [{ name: 'Private name' }] } } as Crop;
  const renderPanel = () => {
    const onMapped = vi.fn();
    render(<PlantHealthPublicationPanel crop={crop} disabled={false} onMapped={onMapped} onBusyChange={vi.fn()} />);
    return onMapped;
  };

  it('does not map typed names and saves only an explicitly selected stable identity', async () => {
    listMock.mockResolvedValue(response(catalogueEntry()));
    mapMock.mockResolvedValue({ data: { ...crop, plant_health: { entries: [{ name: 'Canonical name', catalogue_identity: ID }] } } });
    const mapped = renderPanel();
    const user = userEvent.setup();
    const input = screen.getByRole('combobox');
    await user.type(input, 'Bevorzugter Name');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Zuordnung speichern' })).toBeDisabled();
    expect(mapMock).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('option', { name: /^Bevorzugter Name/ }));
    await user.click(screen.getByRole('button', { name: 'Zuordnung speichern' }));
    await waitFor(() => expect(mapped).toHaveBeenCalledWith(expect.objectContaining({ id: 12 })));
    expect(mapMock).toHaveBeenCalledWith(12, { expected_updated_at: crop.updated_at,
      mappings: [{ local_name: 'Private name', catalogue_identity: ID }] });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates only a one-language pending broad proposal without mapping the private crop', async () => {
    createMock.mockResolvedValue({ data: { id: 3, status: 'proposed' } });
    const mapped = renderPanel();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Namen zur Prüfung vorschlagen' }));
    await screen.findByText('Vorschlag eingereicht. Der Name bleibt bis zur ausdrücklichen Zuordnung privat.');
    expect(createMock).toHaveBeenCalledWith({ name: 'Private name', kind: 'group', scientific_name: '', eppo_code: '', sources: [],
      translations: [{ language_code: 'de', preferred_name: 'Private name' }] });
    expect(mapMock).not.toHaveBeenCalled();
    expect(mapped).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Namen zur Prüfung vorschlagen' })).toBeDisabled();
  });

  it('keeps stale mappings unsaved and gives a localized reload instruction', async () => {
    listMock.mockResolvedValue(response(catalogueEntry()));
    mapMock.mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
    const mapped = renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /^Bevorzugter Name/ }));
    await user.click(screen.getByRole('button', { name: 'Zuordnung speichern' }));
    await screen.findByText(/Die Kultur oder Auswahl hat sich geändert/);
    expect(mapped).not.toHaveBeenCalled();
    expect(mapMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Private name')).toBeInTheDocument();
  });

  it('distinguishes same-label identities by scientific name and permits only one mapping target', async () => {
    listMock.mockResolvedValue(response(catalogueEntry(), { ...catalogueEntry(OTHER_ID), scientific_name: 'Syntheticus other' }));
    function ControlledPicker() {
      const [value, setValue] = useState<PlantHealthSelections | null>(null);
      return <PlantHealthField value={value} onChange={setValue} localOptions={[]} canInherit={false} allowLocal={false} selectionLimit={1} />;
    }
    render(<ControlledPicker />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox'));
    const first = await screen.findByRole('option', { name: /Bevorzugter Name.*Syntheticus example/ });
    expect(screen.getByRole('option', { name: /Bevorzugter Name.*Syntheticus other/ })).toBeVisible();
    await user.click(first);
    await user.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: /Syntheticus other/ })).toHaveAttribute('aria-disabled', 'true');
  });
});


it('retains unsaved private names when linking a draft and compares only official identities', () => {
  const local = { entries: [{ name: 'Private draft' }] };
  const official = { entries: [{ name: 'Same display', catalogue_identity: ID }] };
  expect(planLibraryLink({ plant_health: local }, { plant_health: official }).fills.plant_health).toEqual({ entries: [...local.entries, ...official.entries] });
  const current = { entries: [...local.entries, { name: 'Old snapshot', catalogue_identity: OTHER_ID }] };
  const plan = planLibraryLink({ plant_health: current }, { plant_health: official });
  expect(plan.conflicts).toHaveLength(1);
  expect(pickLibraryChoices(plan.conflicts, { plant_health: 'library' }).plant_health).toEqual({ entries: [...local.entries, ...official.entries] });
  expect(pickLibraryChoices(plan.conflicts, { plant_health: 'mine' })).toEqual({});
  expect(planLibraryLink({ plant_health: { entries: [...local.entries, { name: 'Different language', catalogue_identity: ID }] } }, { plant_health: official }).conflicts).toEqual([]);
});

it('maps inherited names explicitly on the named general culture without writing the variety', async () => {
  const general = { id: 24, name: 'Synthetic general culture', updated_at: '2026-11-16T01:00:00Z', plant_health: { entries: [{ name: 'Inherited local name' }] } } as Crop;
  const variety = { id: 25, name: general.name, variety: 'Synthetic child', general_crop: general.id, plant_health: null,
    updated_at: '2026-11-16T02:00:00Z', effective_values: { plant_health: general.plant_health } } as Crop;
  listMock.mockResolvedValue(response(catalogueEntry()));
  mapMock.mockResolvedValue({ data: { ...general, plant_health: { entries: [{ name: 'Canonical name', catalogue_identity: ID }] } } });
  const onMapped = vi.fn();
  render(<PlantHealthPublicationPanel crop={variety} inheritedSource={general} disabled={false} onMapped={onMapped} onBusyChange={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Diese Sorte übernimmt die Einträge von „Synthetic general culture“.');
  expect(screen.getByRole('alert')).toHaveTextContent('sie gilt für alle erbenden Sorten');
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: /^Bevorzugter Name/ }));
  await user.click(screen.getByRole('button', { name: 'Zuordnung speichern' }));
  await waitFor(() => expect(onMapped).toHaveBeenCalledWith(expect.objectContaining({ id: 24 })));
  expect(mapMock).toHaveBeenCalledWith(24, { expected_updated_at: general.updated_at,
    mappings: [{ local_name: 'Inherited local name', catalogue_identity: ID }] });
  expect(variety.plant_health).toBeNull();
});


it('offers an explicit general-culture edit link when inherited source data is unavailable', async () => {
  const crop = { id: 25, name: 'Synthetic culture', variety: 'Child', general_crop: 24, plant_health: null,
    effective_values: { plant_health: { entries: [{ name: 'Inherited name' }] } } } as Crop;
  const close = vi.fn();
  render(<MemoryRouter><PlantHealthPublicationPanel crop={crop} disabled={false} onMapped={vi.fn()} onBusyChange={vi.fn()} onNavigate={close} /></MemoryRouter>);
  const link = screen.getByRole('link', { name: 'Übergeordnete Kultur bearbeiten' });
  expect(link).toHaveAttribute('href', '/app/crops?cropId=24&action=edit');
  expect(screen.queryByRole('button', { name: 'Zuordnung speichern' })).not.toBeInTheDocument();
  await userEvent.setup().click(link);
  expect(close).toHaveBeenCalledOnce();
  expect(mapMock).not.toHaveBeenCalled();
});

it('keeps explicit empty overrides distinct from inheritance while preserving private names on library choices', () => {
  const empty = { entries: [] };
  const referenced = { entries: [{ name: 'Snapshot', catalogue_identity: ID }] };
  const plan = planLibraryLink({ plant_health: empty }, { plant_health: referenced });
  expect(plan.conflicts).toHaveLength(1);
  expect(pickLibraryChoices(plan.conflicts, { plant_health: 'mine' })).toEqual({});
  expect(planLibraryLink({ plant_health: null }, { plant_health: empty }).fills.plant_health).toEqual(empty);
  expect(planLibraryLink({ plant_health: empty }, { plant_health: empty }).conflicts).toEqual([]);
});
