import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupplierFormDialog } from '../components/suppliers/SupplierFormDialog';
import type { Supplier } from '../api/types';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    supplierAPI: { ...actual.supplierAPI, create: mocks.create, update: mocks.update },
  };
});

const supplier = (overrides: Partial<Supplier> = {}): Supplier => ({
  id: 7,
  name: 'Reinsaat',
  homepage_url: 'https://reinsaat.at',
  ...overrides,
} as Supplier);

const saved = (name = 'Reinsaat') => ({ data: supplier({ name }) });

interface RenderOptions {
  supplier?: Supplier | null;
  title?: string;
  submitLabel?: string;
  onClose?: () => void;
  onSaved?: (value: Supplier) => Promise<void> | void;
}

const renderDialog = ({ supplier: value = null, ...rest }: RenderOptions = {}) => {
  const onClose = rest.onClose ?? vi.fn();
  const onSaved = rest.onSaved ?? vi.fn();
  const view = render(
    <SupplierFormDialog
      open
      supplier={value}
      title={rest.title}
      submitLabel={rest.submitLabel}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { ...view, onClose, onSaved };
};

const nameField = () => screen.getByRole('textbox', { name: 'Name' });
const websiteField = () => screen.getByRole('textbox', { name: 'Webseite' });
const submitButton = () => screen.getByRole('button', { name: 'Speichern' });

/** Fills both fields and submits, returning the payload the API was handed. */
const saveWith = async (
  user: ReturnType<typeof userEvent.setup>,
  { name, website }: { name: string; website?: string },
) => {
  await user.clear(nameField());
  await user.type(nameField(), name);
  if (website !== undefined) {
    await user.clear(websiteField());
    if (website) await user.type(websiteField(), website);
  }
  await user.click(submitButton());
};

beforeEach(() => {
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.create.mockResolvedValue(saved());
  mocks.update.mockResolvedValue(saved());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * The dialog behind both "add supplier" on the suppliers page and the inline
 * supplier creation inside the crop form. `SuppliersPage.test.tsx` covers how
 * the page opens it; what it does once open is here.
 *
 * One thing is deliberately left unpinned: the `http:`/`https:` protocol check
 * in `isValidUrl` cannot fail. Anything reaching it has already been through
 * `normalizeUrl`, which either found an http(s) scheme or prefixed one, so the
 * only rejection that check can produce in practice is a URL that will not
 * parse at all -- which is covered below.
 */
describe('SupplierFormDialog', () => {
  describe('website normalization', () => {
    it('prefixes a bare domain with https rather than http', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: 'reinsaat.at' });

      // Defaulting to http would quietly send people to the insecure origin.
      await waitFor(() =>
        expect(mocks.create).toHaveBeenCalledWith('Reinsaat', 'https://reinsaat.at', []),
      );
    });

    it('leaves an address that already has a scheme alone', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: 'https://reinsaat.at' });

      await waitFor(() =>
        expect(mocks.create).toHaveBeenCalledWith('Reinsaat', 'https://reinsaat.at', []),
      );
    });

    it('keeps a deliberate http address as http', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: 'http://reinsaat.at' });

      // Some supplier sites are still http only; upgrading the scheme for them
      // would store an address that does not resolve.
      await waitFor(() =>
        expect(mocks.create).toHaveBeenCalledWith('Reinsaat', 'http://reinsaat.at', []),
      );
    });

    it('recognises a scheme typed in capitals', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: 'HTTPS://reinsaat.at' });

      // Otherwise it would be prefixed again, into https://HTTPS://...
      await waitFor(() =>
        expect(mocks.create).toHaveBeenCalledWith('Reinsaat', 'HTTPS://reinsaat.at', []),
      );
    });

    it('trims the address before deciding what to do with it', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: '  https://reinsaat.at  ' });

      // A leading space would hide the scheme from the check and produce
      // https://  https://reinsaat.at.
      await waitFor(() =>
        expect(mocks.create).toHaveBeenCalledWith('Reinsaat', 'https://reinsaat.at', []),
      );
    });

    it('trims the name too', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: '  Reinsaat  ', website: '' });

      await waitFor(() =>
        expect(mocks.create).toHaveBeenCalledWith('Reinsaat', '', []),
      );
    });

    it('sends the normalized address, not what was typed', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: 'reinsaat.at' });

      await waitFor(() => expect(mocks.create).toHaveBeenCalled());
      expect(mocks.create.mock.calls[0][1]).toBe('https://reinsaat.at');
    });
  });

  describe('website validation', () => {
    it('refuses an address that cannot be parsed, without calling the API', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: 'https://' });

      expect(
        await screen.findByText('Bitte geben Sie eine gültige URL ein (z.B. https://example.com).'),
      ).toBeInTheDocument();
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('clears the complaint as soon as the address is edited', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: 'https://' });
      await screen.findByText('Bitte geben Sie eine gültige URL ein (z.B. https://example.com).');

      await user.type(websiteField(), 'reinsaat.at');

      // Leaving the error under a field the user is already fixing reads as
      // though the correction has not been noticed.
      expect(
        screen.queryByText('Bitte geben Sie eine gültige URL ein (z.B. https://example.com).'),
      ).not.toBeInTheDocument();
    });

    it('lets an empty address through', async () => {
      const user = userEvent.setup();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: '' });

      // The website is optional, so an empty one is not an invalid one.
      await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('Reinsaat', '', []));
      expect(
        screen.queryByText('Bitte geben Sie eine gültige URL ein (z.B. https://example.com).'),
      ).not.toBeInTheDocument();
    });
  });

  describe('creating versus editing', () => {
    it('creates when there is no supplier to edit', async () => {
      const user = userEvent.setup();
      renderDialog();

      expect(screen.getByRole('heading', { name: 'Lieferant hinzufügen' })).toBeInTheDocument();

      await saveWith(user, { name: 'Bingenheimer', website: '' });

      await waitFor(() => expect(mocks.create).toHaveBeenCalled());
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('updates the supplier it was opened for', async () => {
      const user = userEvent.setup();
      renderDialog({ supplier: supplier() });

      expect(screen.getByRole('heading', { name: 'Lieferant bearbeiten' })).toBeInTheDocument();

      await user.clear(nameField());
      await user.type(nameField(), 'Reinsaat GmbH');
      await user.click(submitButton());

      // Creating here would leave the original behind and add a duplicate.
      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith(7, {
          name: 'Reinsaat GmbH',
          homepage_url: 'https://reinsaat.at',
          allowed_domains: [],
        }),
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('fills the fields from the supplier being edited', async () => {
      renderDialog({ supplier: supplier() });

      expect(nameField()).toHaveValue('Reinsaat');
      expect(websiteField()).toHaveValue('https://reinsaat.at');
    });

    it('re-reads the fields when it is handed a different supplier', async () => {
      const { rerender } = renderDialog({ supplier: supplier() });
      expect(nameField()).toHaveValue('Reinsaat');

      rerender(
        <SupplierFormDialog
          open
          supplier={supplier({ id: 8, name: 'Bingenheimer', homepage_url: '' })}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );

      // Editing one row and then another must not show the first one's values.
      await waitFor(() => expect(nameField()).toHaveValue('Bingenheimer'));
      expect(websiteField()).toHaveValue('');
    });

    it('starts empty again after being reopened for a new supplier', async () => {
      const user = userEvent.setup();
      const { rerender } = renderDialog();
      await user.type(nameField(), 'halb getippt');

      rerender(
        <SupplierFormDialog open={false} supplier={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );
      rerender(
        <SupplierFormDialog open supplier={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      await waitFor(() => expect(nameField()).toHaveValue(''));
    });

    it('puts the cursor in the name field', async () => {
      vi.useFakeTimers();
      renderDialog();

      // Scheduled on a timeout so MUI's own focus handling has settled first.
      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(nameField()).toHaveFocus();
    });
  });

  describe('required name', () => {
    it('cannot be saved without a name', async () => {
      renderDialog();

      expect(submitButton()).toBeDisabled();
    });

    it('does not accept spaces as a name', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(nameField(), '   ');

      expect(submitButton()).toBeDisabled();
    });

    it('explains why the submit button is disabled', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.hover(submitButton().parentElement as HTMLElement);

      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Bitte alle Pflichtfelder ausfüllen.',
      );
    });
  });

  describe('while a save is in flight', () => {
    const pendingSave = () => {
      let resolve: (value: { data: Supplier }) => void = () => {};
      mocks.create.mockReturnValue(
        new Promise<{ data: Supplier }>((innerResolve) => {
          resolve = innerResolve;
        }),
      );
      return { resolve: () => resolve(saved()) };
    };

    it('disables the fields and both buttons', async () => {
      const user = userEvent.setup();
      pendingSave();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat' });

      await waitFor(() => expect(submitButton()).toBeDisabled());
      expect(nameField()).toBeDisabled();
      expect(websiteField()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    });

    it('ignores a second submit', async () => {
      const user = userEvent.setup();
      pendingSave();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat' });
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

      // The button is disabled, so submit the form directly -- an Enter press
      // in a text field does the same thing, and creating the supplier twice
      // is the failure this guard exists for.
      fireEvent.submit(nameField().closest('form') as HTMLFormElement);

      expect(mocks.create).toHaveBeenCalledTimes(1);
    });

    it('refuses to close, so a save cannot be abandoned half-done', async () => {
      const user = userEvent.setup();
      pendingSave();
      const { onClose } = renderDialog();

      await saveWith(user, { name: 'Reinsaat' });
      await waitFor(() => expect(mocks.create).toHaveBeenCalled());

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('says why the buttons are disabled', async () => {
      const user = userEvent.setup();
      pendingSave();
      renderDialog();

      await saveWith(user, { name: 'Reinsaat' });
      await waitFor(() => expect(submitButton()).toBeDisabled());

      await user.hover(screen.getByRole('button', { name: 'Abbrechen' }).parentElement as HTMLElement);

      expect(await screen.findByRole('tooltip')).toHaveTextContent('Aktion wird gerade verarbeitet.');
    });
  });

  describe('after a successful save', () => {
    it('hands the saved supplier to the caller and closes', async () => {
      const user = userEvent.setup();
      const onSaved = vi.fn();
      const { onClose } = renderDialog({ onSaved });

      await saveWith(user, { name: 'Reinsaat' });

      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(supplier()));
      expect(onClose).toHaveBeenCalled();
    });

    it('waits for the caller before closing', async () => {
      const user = userEvent.setup();
      let releaseCaller: () => void = () => {};
      const onSaved = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseCaller = resolve;
          }),
      );
      const { onClose } = renderDialog({ onSaved });

      await saveWith(user, { name: 'Reinsaat' });
      await waitFor(() => expect(onSaved).toHaveBeenCalled());

      // The caller reloads the list; closing before it finishes would flash
      // the old table behind the dialog on the way out.
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => {
        releaseCaller();
      });

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('when the server refuses', () => {
    const axiosError = (data: unknown) =>
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { data },
      });

    it('shows a field error against the field it belongs to', async () => {
      const user = userEvent.setup();
      mocks.create.mockRejectedValue(axiosError({ name: 'Dieser Name ist bereits vergeben.' }));
      renderDialog();

      await saveWith(user, { name: 'Reinsaat' });

      expect(await screen.findByText('Dieser Name ist bereits vergeben.')).toBeInTheDocument();
      expect(
        screen.queryByText('Lieferant konnte nicht gespeichert werden.'),
      ).not.toBeInTheDocument();
    });

    it('joins a list of complaints about one field into one message', async () => {
      const user = userEvent.setup();
      mocks.create.mockRejectedValue(
        axiosError({ homepage_url: ['Ungültige URL.', 'Domain nicht erreichbar.'] }),
      );
      renderDialog();

      await saveWith(user, { name: 'Reinsaat' });

      // DRF returns a list per field; showing only the first would hide the
      // second reason the save was refused.
      expect(
        await screen.findByText('Ungültige URL. Domain nicht erreichbar.'),
      ).toBeInTheDocument();
    });

    it('falls back to a general message when nothing names a field', async () => {
      const user = userEvent.setup();
      mocks.create.mockRejectedValue(axiosError({ detail: 'Nope' }));
      renderDialog();

      await saveWith(user, { name: 'Reinsaat' });

      expect(
        await screen.findByText('Lieferant konnte nicht gespeichert werden.'),
      ).toBeInTheDocument();
    });

    it('falls back to a general message for a failure with no response at all', async () => {
      const user = userEvent.setup();
      mocks.create.mockRejectedValue(new Error('Network down'));
      renderDialog();

      await saveWith(user, { name: 'Reinsaat' });

      expect(
        await screen.findByText('Lieferant konnte nicht gespeichert werden.'),
      ).toBeInTheDocument();
    });

    it('stays open and saveable so the input is not lost', async () => {
      const user = userEvent.setup();
      mocks.create.mockRejectedValue(axiosError({ detail: 'Nope' }));
      const { onClose } = renderDialog();

      await saveWith(user, { name: 'Reinsaat' });
      await screen.findByText('Lieferant konnte nicht gespeichert werden.');

      expect(onClose).not.toHaveBeenCalled();
      expect(nameField()).toHaveValue('Reinsaat');
      expect(submitButton()).toBeEnabled();
    });

    it('clears the previous complaint when the save is retried', async () => {
      const user = userEvent.setup();
      mocks.create.mockRejectedValueOnce(axiosError({ name: 'Bereits vergeben.' }));
      renderDialog();

      await saveWith(user, { name: 'Reinsaat' });
      await screen.findByText('Bereits vergeben.');

      await user.click(submitButton());

      // A stale error next to a field that has just been accepted is worse
      // than no error at all.
      await waitFor(() => expect(screen.queryByText('Bereits vergeben.')).not.toBeInTheDocument());
    });

    it('forgets the complaint when reopened', async () => {
      const user = userEvent.setup();
      mocks.create.mockRejectedValue(axiosError({ name: 'Bereits vergeben.' }));
      const { rerender } = renderDialog();

      await saveWith(user, { name: 'Reinsaat' });
      await screen.findByText('Bereits vergeben.');

      rerender(
        <SupplierFormDialog open={false} supplier={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );
      rerender(
        <SupplierFormDialog open supplier={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      await waitFor(() => expect(screen.queryByText('Bereits vergeben.')).not.toBeInTheDocument());
    });

    it('clears a name complaint when the name is edited, leaving the website alone', async () => {
      const user = userEvent.setup();
      mocks.create.mockRejectedValue(
        axiosError({ name: 'Bereits vergeben.', homepage_url: 'Ungültige URL.' }),
      );
      renderDialog();

      await saveWith(user, { name: 'Reinsaat', website: 'reinsaat.at' });
      await screen.findByText('Bereits vergeben.');
      expect(screen.getByText('Ungültige URL.')).toBeInTheDocument();

      await user.type(nameField(), ' GmbH');

      expect(screen.queryByText('Bereits vergeben.')).not.toBeInTheDocument();
      expect(screen.getByText('Ungültige URL.')).toBeInTheDocument();
    });
  });

  describe('closing', () => {
    it('closes on Escape', async () => {
      const { onClose } = renderDialog();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });

    it('keeps Escape to itself so nothing behind it also closes', async () => {
      const outer = vi.fn();
      document.addEventListener('keydown', outer);
      renderDialog();

      fireEvent.keyDown(document, { key: 'Escape' });

      // The crop form opens this dialog from inside its own dialog; a leaked
      // Escape would close both at once.
      expect(outer).not.toHaveBeenCalled();
      document.removeEventListener('keydown', outer);
    });

    it('closes from the cancel button without submitting', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await user.type(nameField(), 'Reinsaat');

      await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

      expect(onClose).toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    });
  });

  describe('as a reusable dialog', () => {
    it("takes the caller's own title and submit label", async () => {
      renderDialog({ title: 'Lieferanten anlegen', submitLabel: 'Anlegen' });

      // What the crop form does, so the button reads as part of that flow
      // rather than as a generic save.
      expect(screen.getByRole('heading', { name: 'Lieferanten anlegen' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Anlegen' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    });

    it('names itself by its heading', async () => {
      renderDialog();

      expect(screen.getByRole('dialog')).toHaveAccessibleName('Lieferant hinzufügen');
    });
  });
});
