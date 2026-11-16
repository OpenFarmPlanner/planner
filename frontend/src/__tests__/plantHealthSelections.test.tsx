import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { PlantHealthSelections } from '../api/types';
import type { PlantHealthEntry } from '../crop-library/plant-health/types';
import { PlantHealthField } from '../crops/sections/PlantHealthField';
import { PlantHealthChips } from '../crops/PlantHealthChips';
import { normalizePlantHealthSelections, collectLocalPlantHealth } from '../crops/plantHealth';
import i18n from '../i18n/config';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('../crop-library/plant-health/api', () => ({ plantHealthAPI: { list: listMock } }));
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
    await screen.findByRole('option', { name: 'Bevorzugter Name' });
    await user.keyboard('{Enter}');
    expect(change).toHaveBeenLastCalledWith({ entries: [{ name: 'Bevorzugter Name' }] });
  });

  it('offers a catalogue result matched by a synonym and requires explicit selection', async () => {
    listMock.mockResolvedValue(response(catalogueEntry()));
    const change = vi.fn();
    const user = userEvent.setup();
    render(<PlantHealthField value={null} localOptions={[]} onChange={change} canInherit={false} />);
    await user.type(screen.getByRole('combobox', { name: 'Schädlings- und Krankheitseinträge' }), 'Synonym');
    await user.click(await screen.findByRole('option', { name: 'Bevorzugter Name' }));
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
