import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  InlineEditor,
  SectionAlerts,
  SettingsCard,
} from '../pages/accountSettingsCards';
import { expectNoTooltip, tooltipOf } from './helpers/disabledActionTooltip';

const saveButton = (): HTMLElement => screen.getByRole('button', { name: 'Namen speichern' });
const cancelButton = (): HTMLElement => screen.getByRole('button', { name: 'Abbrechen' });

interface EditorOptions {
  open?: boolean;
  submitting?: boolean;
  saveDisabled?: boolean;
}

const renderEditor = ({
  open = true,
  submitting = false,
  saveDisabled = false,
}: EditorOptions = {}) => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <InlineEditor
      open={open}
      saveLabel="Namen speichern"
      onSave={onSave}
      onCancel={onCancel}
      submitting={submitting}
      saveDisabled={saveDisabled}
    >
      <input aria-label="Anzeigename" defaultValue="Martin" />
    </InlineEditor>,
  );
  return { ...view, onSave, onCancel };
};

/**
 * The three presentational pieces the account settings page is built from. They
 * hold no data of their own -- the sections in `AccountSettingsPage.tsx` and its
 * two card modules own that -- so what is covered here is the behaviour those
 * sections rely on and would not notice breaking: what stays mounted while
 * collapsed, which of the two disabled reasons each action explains, and
 * whether a submit can slip past a disabled save button.
 */
describe('SectionAlerts', () => {
  it('shows a success message as a success alert', () => {
    render(<SectionAlerts message="Gespeichert." error={null} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Gespeichert.');
    expect(alert).toHaveClass('MuiAlert-colorSuccess');
  });

  it('shows an error as an error alert', () => {
    render(<SectionAlerts message={null} error="Fehlgeschlagen." />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Fehlgeschlagen.');
    expect(alert).toHaveClass('MuiAlert-colorError');
  });

  /** A retry that fails after a success has both to report, in that order. */
  it('shows both at once, success first', () => {
    render(<SectionAlerts message="Gespeichert." error="Fehlgeschlagen." />);
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent('Gespeichert.');
    expect(alerts[1]).toHaveTextContent('Fehlgeschlagen.');
  });

  it.each([
    ['nothing to report', null, null],
    ['an empty message', '', ''],
  ])('renders no alert for %s', (_label, message, error) => {
    render(<SectionAlerts message={message} error={error} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('InlineEditor', () => {
  describe('being open', () => {
    it('shows its fields and actions', () => {
      renderEditor({ open: true });
      expect(screen.getByLabelText('Anzeigename')).toBeInTheDocument();
      expect(saveButton()).toBeInTheDocument();
      expect(cancelButton()).toBeInTheDocument();
    });

    /**
     * `unmountOnExit` is what makes reopening an editor start clean: a closed
     * editor's fields are gone rather than hidden, so nothing the user typed
     * and abandoned is still in the DOM waiting to be submitted.
     */
    it('unmounts everything while closed', () => {
      renderEditor({ open: false });
      expect(screen.queryByLabelText('Anzeigename')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('discards what was typed when it reopens', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <InlineEditor
          open
          saveLabel="Namen speichern"
          onSave={vi.fn()}
          onCancel={vi.fn()}
          submitting={false}
        >
          <input aria-label="Anzeigename" defaultValue="Martin" />
        </InlineEditor>,
      );
      await user.clear(screen.getByLabelText('Anzeigename'));
      await user.type(screen.getByLabelText('Anzeigename'), 'Geändert');

      const withOpen = (open: boolean) => (
        <InlineEditor
          open={open}
          saveLabel="Namen speichern"
          onSave={vi.fn()}
          onCancel={vi.fn()}
          submitting={false}
        >
          <input aria-label="Anzeigename" defaultValue="Martin" />
        </InlineEditor>
      );
      rerender(withOpen(false));
      await waitFor(() =>
        expect(screen.queryByLabelText('Anzeigename')).not.toBeInTheDocument(),
      );
      rerender(withOpen(true));

      expect(screen.getByLabelText('Anzeigename')).toHaveValue('Martin');
    });
  });

  describe('saving', () => {
    it('saves on the button', async () => {
      const user = userEvent.setup();
      const { onSave, onCancel } = renderEditor();
      await user.click(saveButton());
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('saves on Enter in a field, without navigating away', async () => {
      const user = userEvent.setup();
      const { onSave } = renderEditor();
      await user.click(screen.getByLabelText('Anzeigename'));
      await user.keyboard('{Enter}');
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    /**
     * Without `preventDefault` the browser would navigate on submit and reload
     * the settings page mid-save. jsdom does not implement form submission, so
     * the only way to see it is whether the event came back cancelled.
     */
    it('keeps the browser from submitting the form itself', () => {
      const { onSave, container } = renderEditor();
      const form = container.querySelector('form') as HTMLFormElement;
      const notCancelled = fireEvent.submit(form);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(notCancelled).toBe(false);
    });

    it('cancels without saving', async () => {
      const user = userEvent.setup();
      const { onSave, onCancel } = renderEditor();
      await user.click(cancelButton());
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('while the save is in flight', () => {
    it('disables both actions', () => {
      renderEditor({ submitting: true });
      expect(saveButton()).toBeDisabled();
      expect(cancelButton()).toBeDisabled();
    });

    it('says why', async () => {
      const user = userEvent.setup();
      renderEditor({ submitting: true });
      expect(await tooltipOf(user, saveButton())).toHaveTextContent(
        'Aktion wird gerade verarbeitet.',
      );
      expect(await tooltipOf(user, cancelButton())).toHaveTextContent(
        'Aktion wird gerade verarbeitet.',
      );
    });

    /**
     * A disabled submit button is not enough on its own: the form can still be
     * submitted programmatically, and this is the guard that keeps a second
     * save from starting while the first is still running.
     */
    it('refuses a submit that reaches the form anyway', () => {
      const { onSave, container } = renderEditor({ submitting: true });
      const form = container.querySelector('form') as HTMLFormElement;
      act(() => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('while the form is incomplete', () => {
    it('disables saving but leaves cancelling available', () => {
      renderEditor({ saveDisabled: true });
      expect(saveButton()).toBeDisabled();
      expect(cancelButton()).toBeEnabled();
    });

    /**
     * The cancel button is checked first on purpose. `expectNoTooltip` also
     * asserts that no tooltip is open anywhere, and MUI keeps one visible
     * through its leave delay -- so hovering cancel straight after the save
     * tooltip makes the assertion race that delay.
     */
    it('says which reason applies to which action', async () => {
      const user = userEvent.setup();
      renderEditor({ saveDisabled: true });
      await expectNoTooltip(user, cancelButton());
      expect(await tooltipOf(user, saveButton())).toHaveTextContent(
        'Bitte alle Pflichtfelder ausfüllen.',
      );
    });

    /** Being busy is the more urgent of the two, so it wins the explanation. */
    it('reports being busy rather than being incomplete when both apply', async () => {
      const user = userEvent.setup();
      renderEditor({ submitting: true, saveDisabled: true });
      expect(await tooltipOf(user, saveButton())).toHaveTextContent(
        'Aktion wird gerade verarbeitet.',
      );
    });

    it('refuses a submit that reaches the form anyway', () => {
      const { onSave, container } = renderEditor({ saveDisabled: true });
      const form = container.querySelector('form') as HTMLFormElement;
      act(() => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('when nothing blocks the save', () => {
    it('explains nothing on either action', async () => {
      const user = userEvent.setup();
      renderEditor();
      await expectNoTooltip(user, saveButton());
      await expectNoTooltip(user, cancelButton());
    });

    it('treats an omitted saveDisabled as not disabled', () => {
      render(
        <InlineEditor
          open
          saveLabel="Namen speichern"
          onSave={vi.fn()}
          onCancel={vi.fn()}
          submitting={false}
        >
          <input aria-label="Anzeigename" />
        </InlineEditor>,
      );
      expect(saveButton()).toBeEnabled();
    });

    it('labels the save action with what the caller passed', () => {
      renderEditor();
      expect(screen.getByRole('button', { name: 'Namen speichern' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    });
  });
});

describe('SettingsCard', () => {
  describe('the plain card', () => {
    it('shows its title, description and content at once', () => {
      render(
        <SettingsCard title="Profil" description="Dein Name und deine E-Mail-Adresse.">
          <div>Inhalt</div>
        </SettingsCard>,
      );
      expect(screen.getByRole('heading', { name: 'Profil' })).toBeInTheDocument();
      expect(screen.getByText('Dein Name und deine E-Mail-Adresse.')).toBeInTheDocument();
      expect(screen.getByText('Inhalt')).toBeInTheDocument();
    });

    it('offers nothing to expand', () => {
      render(
        <SettingsCard title="Profil">
          <div>Inhalt</div>
        </SettingsCard>,
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    /**
     * Rendering the description slot regardless would leave an empty paragraph
     * with its own bottom margin, so the gap below the title would differ
     * between a card that has a description and one that does not.
     */
    it('leaves out a description it was not given', () => {
      const { container } = render(
        <SettingsCard title="Profil">
          <div>Inhalt</div>
        </SettingsCard>,
      );
      expect(screen.getByRole('heading', { name: 'Profil' })).toBeInTheDocument();
      expect(screen.getByText('Inhalt')).toBeInTheDocument();
      expect(container.querySelectorAll('p')).toHaveLength(0);
    });
  });

  describe('the collapsible card', () => {
    const renderCollapsible = (defaultExpanded = false) =>
      render(
        <SettingsCard
          title="API-Token"
          description="Token für den Agent-Zugriff."
          collapsible
          defaultExpanded={defaultExpanded}
        >
          <div>Inhalt</div>
        </SettingsCard>,
      );

    it('starts collapsed, with the title still readable', () => {
      renderCollapsible();
      expect(screen.getByRole('heading', { name: 'API-Token' })).toBeInTheDocument();
      expect(screen.queryByText('Inhalt')).not.toBeInTheDocument();
      expect(screen.queryByText('Token für den Agent-Zugriff.')).not.toBeInTheDocument();
    });

    it('starts collapsed when the caller says nothing about it', () => {
      render(
        <SettingsCard title="API-Token" collapsible>
          <div>Inhalt</div>
        </SettingsCard>,
      );
      expect(screen.queryByText('Inhalt')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
    });

    it('can start expanded', () => {
      renderCollapsible(true);
      expect(screen.getByText('Inhalt')).toBeInTheDocument();
      expect(screen.getByText('Token für den Agent-Zugriff.')).toBeInTheDocument();
    });

    it('announces its state to assistive technology', async () => {
      const user = userEvent.setup();
      renderCollapsible();
      const toggle = screen.getByRole('button', { expanded: false });
      await user.click(toggle);
      expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    });

    it('opens and closes again on the same control', async () => {
      const user = userEvent.setup();
      renderCollapsible();
      const toggle = screen.getByRole('button');

      await user.click(toggle);
      expect(await screen.findByText('Inhalt')).toBeInTheDocument();

      await user.click(toggle);
      await waitFor(() => expect(screen.queryByText('Inhalt')).not.toBeInTheDocument());
    });

    it('names the whole header as the control, not just an icon', () => {
      renderCollapsible();
      expect(screen.getByRole('button', { name: 'API-Token' })).toBeInTheDocument();
    });

    /**
     * The chevron is decoration: the button already carries the title and the
     * expanded state, so exposing the icon again would make a screen reader
     * read the row twice.
     */
    it('hides the chevron from assistive technology', () => {
      const { container } = renderCollapsible();
      const hidden = container.querySelector('[aria-hidden="true"]');
      expect(hidden?.querySelector('svg')).toBeInTheDocument();
    });

    it('turns the chevron over when expanded', async () => {
      const user = userEvent.setup();
      const { container } = renderCollapsible();
      const chevron = container.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(window.getComputedStyle(chevron).transform).toBe('rotate(0deg)');

      await user.click(screen.getByRole('button'));

      await waitFor(() =>
        expect(window.getComputedStyle(chevron).transform).toBe('rotate(180deg)'),
      );
    });
  });
});
