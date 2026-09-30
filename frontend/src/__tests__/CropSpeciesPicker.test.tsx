import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CropSpeciesPicker, type CropSpeciesPickerProps } from '../crops/CropSpeciesPicker';
import type { CropSpecies } from '../api/types';

const species = (overrides: Partial<CropSpecies> = {}): CropSpecies => ({
  id: 1,
  name: 'Tomate',
  status: 'published',
  search_names: ['Tomate', 'Paradeiser', 'Solanum lycopersicum'],
  ...overrides,
});

const TOMATO = species();
const CARROT = species({
  id: 2,
  name: 'Karotte',
  search_names: ['Karotte', 'Möhre', 'Daucus carota'],
});

type Overrides = Partial<CropSpeciesPickerProps>;

/**
 * A harness that owns `inputValue`, `value` and `proposalName` the way the
 * real callers do. The picker is deliberately uncontrolled in none of these:
 * the owning dialog holds them so its submit button can read the same state,
 * so driving them from the test would not exercise the handshake.
 */
function Harness({ overrides, spies }: {
  overrides: Overrides;
  spies: { onChange: ReturnType<typeof vi.fn>; onProposalNameChange: ReturnType<typeof vi.fn> };
}) {
  const [inputValue, setInputValue] = useState(overrides.inputValue ?? '');
  const [value, setValue] = useState<CropSpecies | null>(overrides.value ?? null);
  const [proposalName, setProposalName] = useState<string | null>(overrides.proposalName ?? null);

  return (
    <CropSpeciesPicker
      species={overrides.species ?? [TOMATO, CARROT]}
      loading={overrides.loading ?? false}
      value={value}
      onChange={(next) => {
        setValue(next);
        spies.onChange(next);
      }}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      proposalName={proposalName}
      onProposalNameChange={(name) => {
        setProposalName(name);
        spies.onProposalNameChange(name);
      }}
      proposing={overrides.proposing}
      errorText={overrides.errorText}
      label={overrides.label}
      required={overrides.required}
      serverSearched={overrides.serverSearched}
    />
  );
}

const setup = (overrides: Overrides = {}) => {
  const spies = { onChange: vi.fn(), onProposalNameChange: vi.fn() };
  const view = render(<Harness overrides={overrides} spies={spies} />);
  return { ...view, ...spies };
};

const field = () => screen.getByRole('combobox');
const listbox = () => screen.getByRole('listbox');
const proposeOption = (name: string) =>
  screen.getByRole('option', { name: `„${name}“ als neue Kulturart vorschlagen` });

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The official crop-species picker, shared by the publishing wizard and the
 * moderators' "Kulturart korrigieren" dialog, so both search, match and
 * propose in the same way. The matching helpers have their own tests in
 * `cropSpeciesMatching.test.ts`; what is covered here is the picker's own
 * decisions -- when it offers to propose a new species, and the handshake
 * with the owning dialog that keeps a proposal from being lost or filed by
 * accident.
 *
 * One thing is recorded rather than pinned, because it is a bug rather than
 * a behaviour worth locking in: the loading branch of `noOptionsText` never
 * reaches the screen. MUI renders `loadingText` while `loading` is true and
 * only falls back to `noOptionsText` afterwards, so the German
 * `common:loading` string wired into `noOptionsText` is dead and the field
 * shows MUI's untranslated English default instead. Asserting the English
 * string here would pin the bug, so the tests assert only that the
 * "nothing found" message stays away while loading.
 */
describe('CropSpeciesPicker', () => {
  describe('picking an existing species', () => {
    it('lists the catalogue once the field is opened', async () => {
      const user = userEvent.setup();
      setup();

      await user.click(field());

      expect(within(listbox()).getByRole('option', { name: 'Tomate' })).toBeInTheDocument();
      expect(within(listbox()).getByRole('option', { name: 'Karotte' })).toBeInTheDocument();
    });

    it('reports the chosen species and no proposal', async () => {
      const user = userEvent.setup();
      const { onChange, onProposalNameChange } = setup();

      await user.click(field());
      await user.click(screen.getByRole('option', { name: 'Tomate' }));

      expect(onChange).toHaveBeenCalledWith(TOMATO);
      // Picking a real species has to retract any proposal in flight, or
      // the dialog would file one for a species that now exists.
      expect(onProposalNameChange).toHaveBeenLastCalledWith(null);
    });

    it('finds a species under a regional name and says which one matched', async () => {
      const user = userEvent.setup();
      setup();

      await user.type(field(), 'Paradeiser');

      // The alias is what made the option appear, so it is named rather
      // than silently resolving to the canonical species.
      expect(await screen.findByRole('option', { name: 'Tomate (Paradeiser)' })).toBeInTheDocument();
    });

    it('marks a species that is still awaiting review', async () => {
      const user = userEvent.setup();
      setup({ species: [species({ id: 3, name: 'Yacón', status: 'proposed', search_names: ['Yacón'] })] });

      await user.click(field());

      // Otherwise a pending proposal looks like an established entry.
      expect(
        screen.getByRole('option', { name: 'Yacón · Vorschlag in Prüfung' }),
      ).toBeInTheDocument();
    });

    it('clears the selection when the field is emptied', async () => {
      const user = userEvent.setup();
      const { onChange } = setup({ value: TOMATO, inputValue: 'Tomate' });

      await user.clear(field());

      expect(onChange).not.toHaveBeenCalledWith(TOMATO);
    });
  });

  describe('offering to propose a new species', () => {
    it('appears for a name nothing in the catalogue answers to', async () => {
      const user = userEvent.setup();
      setup();

      await user.type(field(), 'Yacon');

      expect(await screen.findByRole('option', { name: /als neue Kulturart vorschlagen/ }))
        .toBeInTheDocument();
    });

    it('stays away while the typed name is an existing species', async () => {
      const user = userEvent.setup();
      setup();

      await user.type(field(), 'Tomate');

      // Proposing a species that exists would create a duplicate for a
      // moderator to reject.
      await waitFor(() => expect(screen.getByRole('option', { name: /Tomate/ })).toBeInTheDocument());
      expect(screen.queryByRole('option', { name: /vorschlagen/ })).not.toBeInTheDocument();
    });

    it('stays away when the name matches only through an alias', async () => {
      const user = userEvent.setup();
      setup();

      await user.type(field(), 'Möhre');

      // A regional name is still that species; the match is strong even
      // though the canonical name differs.
      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'Karotte (Möhre)' })).toBeInTheDocument(),
      );
      expect(screen.queryByRole('option', { name: /vorschlagen/ })).not.toBeInTheDocument();
    });

    it('stays away while the catalogue is still loading', async () => {
      const user = userEvent.setup();
      setup({ loading: true, species: [] });

      await user.type(field(), 'Yacon');

      // Offering to propose against an empty list would invite a duplicate
      // of something not yet loaded.
      expect(screen.queryByRole('option', { name: /vorschlagen/ })).not.toBeInTheDocument();
    });

    it('stays away for an empty field', async () => {
      const user = userEvent.setup();
      setup();

      await user.click(field());

      expect(screen.queryByRole('option', { name: /vorschlagen/ })).not.toBeInTheDocument();
    });

    it('sits below the near misses it did not match', async () => {
      const user = userEvent.setup();
      setup();

      await user.type(field(), 'Tomat');

      // A partial name both surfaces hits and offers the proposal; the
      // proposal comes last so the existing species are seen first.
      const options = within(await screen.findByRole('listbox')).getAllByRole('option');
      expect(options[options.length - 1]).toHaveAccessibleName(/vorschlagen/);
      expect(options.length).toBeGreaterThan(1);
    });
  });

  describe('choosing to propose', () => {
    it('reports the name without selecting a species or calling the server', async () => {
      const user = userEvent.setup();
      const { onChange, onProposalNameChange } = setup();

      await user.type(field(), 'Yacon');
      await user.click(proposeOption('Yacon'));

      // Filing happens when the owning dialog submits, so a dialog the user
      // browses away from leaves no stray proposal behind.
      expect(onProposalNameChange).toHaveBeenLastCalledWith('Yacon');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the proposed name in the field afterwards', async () => {
      const user = userEvent.setup();
      setup();

      await user.type(field(), 'Yacon');
      await user.click(proposeOption('Yacon'));

      // The proposal is not a real species, so MUI writes an empty label
      // back into the field right after the change. Letting that through
      // would blank the name the user just proposed.
      await waitFor(() => expect(field()).toHaveValue('Yacon'));
    });

    it('says in the field itself that a new species will be proposed', async () => {
      const user = userEvent.setup();
      setup();

      await user.type(field(), 'Yacon');
      await user.click(proposeOption('Yacon'));

      // Right where the name is edited, so a typo stays correctable without
      // a further dialog step.
      expect(
        await screen.findByText('Neue Kulturart wird vorgeschlagen: Yacon'),
      ).toBeInTheDocument();
    });

    it('survives losing focus', async () => {
      const user = userEvent.setup();
      setup();

      await user.type(field(), 'Yacon');
      await user.click(proposeOption('Yacon'));
      await waitFor(() => expect(field()).toHaveValue('Yacon'));

      await user.tab();

      // Blur triggers the same label write-back as the reset does.
      expect(field()).toHaveValue('Yacon');
    });

    it('is retracted once the name is edited again', async () => {
      const user = userEvent.setup();
      const { onProposalNameChange } = setup();

      await user.type(field(), 'Yacon');
      await user.click(proposeOption('Yacon'));
      await waitFor(() => expect(field()).toHaveValue('Yacon'));

      await user.type(field(), 'x');

      // Typing on is the user reconsidering; the proposal should not hold a
      // name the field no longer shows.
      expect(onProposalNameChange).toHaveBeenLastCalledWith(null);
    });

    it('cannot be chosen twice while one is being filed', async () => {
      const user = userEvent.setup();
      setup({ proposing: true });

      // Typed rather than pre-set: MUI filters on its own input state, which
      // only carries the value once the field has been typed into.
      await user.type(field(), 'Yacon');

      expect(await screen.findByRole('option', { name: /vorschlagen/ }))
        .toHaveAttribute('aria-disabled', 'true');
    });

    it('shows that filing is under way', async () => {
      const user = userEvent.setup();
      setup({ proposing: true });

      await user.type(field(), 'Yacon');

      const option = await screen.findByRole('option', { name: /vorschlagen/ });
      expect(option.querySelector('.MuiCircularProgress-root')).not.toBeNull();
    });
  });

  describe('committing with Tab', () => {
    it('proposes the highlighted option without a click', async () => {
      const user = userEvent.setup();
      const { onProposalNameChange } = setup();

      await user.type(field(), 'Yacon');
      await screen.findByRole('option', { name: /vorschlagen/ });
      // Arrow down onto the propose entry, then leave the field.
      await user.keyboard('{ArrowDown}');
      await user.tab();

      expect(onProposalNameChange).toHaveBeenCalledWith('Yacon');
    });

    it('proposes the typed name even with nothing highlighted', async () => {
      const user = userEvent.setup();
      const { onProposalNameChange } = setup();

      await user.type(field(), 'Yacon');
      await user.tab();

      // Tabbing out of a field holding an unmatched name is a commit, not a
      // discard.
      expect(onProposalNameChange).toHaveBeenCalledWith('Yacon');
    });

    it('trims what it commits', async () => {
      const user = userEvent.setup();
      const { onProposalNameChange } = setup();

      await user.type(field(), '  Yacon  ');
      await user.tab();

      expect(onProposalNameChange).toHaveBeenCalledWith('Yacon');
    });

    it('proposes nothing for a name that already exists', async () => {
      const user = userEvent.setup();
      const { onProposalNameChange } = setup();

      await user.type(field(), 'Tomate');
      await user.tab();

      expect(onProposalNameChange).not.toHaveBeenCalledWith('Tomate');
    });

    it('proposes nothing from an empty field', async () => {
      const user = userEvent.setup();
      const { onProposalNameChange } = setup();

      await user.click(field());
      await user.tab();

      expect(onProposalNameChange).not.toHaveBeenCalledWith('');
    });

    it('proposes nothing while the catalogue is loading', async () => {
      const user = userEvent.setup();
      const { onProposalNameChange } = setup({ loading: true, species: [] });

      await user.type(field(), 'Yacon');
      await user.tab();

      expect(onProposalNameChange).not.toHaveBeenCalledWith('Yacon');
    });
  });

  describe('in server-searched mode', () => {
    it('keeps the ranked order it was given', async () => {
      const user = userEvent.setup();
      // Karotte first even though the query looks like Tomate: the server
      // ranked it, and re-filtering locally would drop fuzzy hits that do
      // not literally contain the typed text.
      setup({ serverSearched: true, species: [CARROT, TOMATO] });

      await user.type(field(), 'tomate');

      const options = within(await screen.findByRole('listbox')).getAllByRole('option');
      expect(options[0]).toHaveAccessibleName(/Karotte/);
      expect(options[1]).toHaveAccessibleName(/Tomate/);
    });

    it('keeps a result the client filter would have dropped', async () => {
      const user = userEvent.setup();
      setup({ serverSearched: true, species: [CARROT] });

      await user.type(field(), 'zzz');

      expect(within(await screen.findByRole('listbox')).getByRole('option', { name: /Karotte/ }))
        .toBeInTheDocument();
    });

    it('still offers to propose an unmatched name', async () => {
      const user = userEvent.setup();
      setup({ serverSearched: true, species: [] });

      await user.type(field(), 'Yacon');

      expect(await screen.findByRole('option', { name: /vorschlagen/ })).toBeInTheDocument();
    });

    it('arrives focused with its results already open', async () => {
      setup({ serverSearched: true });

      // No interaction at all: the wizard opens this field prefilled with
      // the crop's own name, and `autoFocus` plus `openOnFocus` get the
      // results on screen without an imperative focus call racing the
      // dialog's own mount transition.
      expect(field()).toHaveFocus();
      expect(await screen.findByRole('listbox')).toBeInTheDocument();
    });

    it('waits to be opened when the catalogue was loaded whole', () => {
      setup({ serverSearched: false });

      // The relink dialog has other fields; grabbing focus and opening a
      // 400-entry list on mount would be in the way.
      expect(field()).not.toHaveFocus();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('filters locally when the catalogue was loaded whole', async () => {
      const user = userEvent.setup();
      setup({ serverSearched: false });

      await user.type(field(), 'Karotte');

      const options = within(await screen.findByRole('listbox')).getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveAccessibleName(/Karotte/);
    });
  });

  describe('the field itself', () => {
    it('carries the shared label by default', () => {
      setup();

      expect(field()).toHaveAccessibleName('Offizielle Kulturart');
    });

    it("takes a caller's own label", () => {
      setup({ label: 'Kulturart korrigieren' });

      expect(field()).toHaveAccessibleName('Kulturart korrigieren');
    });

    it('can be marked required', () => {
      setup({ required: true });

      expect(field()).toBeRequired();
    });

    it('shows an error and marks the field', () => {
      setup({ errorText: 'Bitte eine Kulturart wählen.' });

      expect(screen.getByText('Bitte eine Kulturart wählen.')).toBeInTheDocument();
      expect(field()).toHaveAttribute('aria-invalid', 'true');
    });

    it('lets an error displace the proposal note', () => {
      // Both occupy the helper line; the error is the one that blocks
      // submitting, so it wins.
      setup({ errorText: 'Bitte eine Kulturart wählen.', proposalName: 'Yacon' });

      expect(screen.getByText('Bitte eine Kulturart wählen.')).toBeInTheDocument();
      expect(screen.queryByText(/Neue Kulturart wird vorgeschlagen/)).not.toBeInTheDocument();
    });

    it('does not claim there is nothing while the list is still loading', async () => {
      const user = userEvent.setup();
      setup({ loading: true, species: [] });

      await user.click(field());

      // "No species found" would be wrong while the list is on its way. What
      // is shown instead is MUI's own loading text -- see the note above
      // about the German string never reaching the screen.
      expect(screen.queryByText('Keine passende offizielle Kulturart gefunden.'))
        .not.toBeInTheDocument();
    });

    it('says there is nothing once the catalogue really is empty', async () => {
      const user = userEvent.setup();
      setup({ loading: false, species: [] });

      await user.click(field());

      expect(
        await screen.findByText('Keine passende offizielle Kulturart gefunden.'),
      ).toBeInTheDocument();
    });

    it('offers to propose rather than saying nothing was found, once a name is typed', async () => {
      const user = userEvent.setup();
      setup({ loading: false, species: [] });

      await user.type(field(), 'Yacon');

      // An empty catalogue plus a typed name is the propose case, not a dead
      // end -- the "nothing found" message only stands for an empty query.
      expect(await screen.findByRole('option', { name: /vorschlagen/ })).toBeInTheDocument();
      expect(screen.queryByText('Keine passende offizielle Kulturart gefunden.'))
        .not.toBeInTheDocument();
    });
  });
});
