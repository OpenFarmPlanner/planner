import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import ConsentGate from '../auth/ConsentGate';

const acceptConsentMock = vi.fn(async () => undefined);
const logoutMock = vi.fn(async () => undefined);
let authUser: unknown = {
  id: 1,
  email: 'test@example.com',
  pending_consents: ['terms'],
};

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: authUser,
    acceptConsent: acceptConsentMock,
    logout: logoutMock,
  }),
}));

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { version?: string }) => {
      const map: Record<string, string> = {
        'reconsent.accepting': 'Wird bestätigt…',
        'reconsent.logout': 'Abmelden',
        'reconsent.failed': 'Das hat leider nicht funktioniert. Bitte versuche es erneut.',
        'reconsent.currentVersion': `Aktuelle Fassung: ${params?.version ?? ''}`,
        'reconsent.additionalDocuments': 'Ebenfalls aktualisiert:',
        'reconsent.terms.title': 'Die Nutzungsbedingungen wurden aktualisiert',
        'reconsent.terms.body': 'Bitte lies und bestätige die aktuelle Fassung, bevor du OpenFarmPlanner weiter nutzt.',
        'reconsent.terms.linkLabel': 'Nutzungsbedingungen lesen',
        'reconsent.terms.acceptButton': 'Akzeptieren',
        'reconsent.privacy.title': 'Die Datenschutzerklärung wurde aktualisiert',
        'reconsent.privacy.body': 'Bitte lies und bestätige die aktuelle Fassung, bevor du OpenFarmPlanner weiter nutzt.',
        'reconsent.privacy.linkLabel': 'Datenschutzerklärung lesen',
        'reconsent.privacy.acceptButton': 'Akzeptieren',
        'common:disabledReasons.busy': 'Aktion wird gerade verarbeitet.',
        'home:legal.terms.version': 'Stand: 17. Juli 2026',
        'home:legal.privacy.version': 'Stand: 17. Juli 2026',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('ConsentGate', () => {
  beforeEach(() => {
    acceptConsentMock.mockClear();
    logoutMock.mockClear();
    authUser = {
      id: 1,
      email: 'test@example.com',
      pending_consents: ['terms'],
    };
  });

  it('explains that the terms changed, links to the full text, shows the version, and offers a concise accept button', () => {
    render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Die Nutzungsbedingungen wurden aktualisiert' })).toBeInTheDocument();
    expect(screen.getByText(/bevor du OpenFarmPlanner weiter nutzt/)).toBeInTheDocument();
    expect(screen.getByText('Aktuelle Fassung: Stand: 17. Juli 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nutzungsbedingungen lesen' })).toHaveAttribute('href', '/nutzungsbedingungen');
    expect(screen.getByRole('button', { name: 'Akzeptieren' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('moves focus to the heading on mount so screen readers announce the page', () => {
    render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Die Nutzungsbedingungen wurden aktualisiert' })).toHaveFocus();
  });

  it('accepts the current terms version with a single click, no checkbox required', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Akzeptieren' }));

    expect(acceptConsentMock).toHaveBeenCalledWith('terms');
  });

  it('can render and accept a required privacy policy consent', async () => {
    authUser = {
      id: 1,
      email: 'test@example.com',
      pending_consents: ['privacy'],
    };
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Die Datenschutzerklärung wurde aktualisiert' })).toBeInTheDocument();
    expect(screen.getByText('Aktuelle Fassung: Stand: 17. Juli 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Datenschutzerklärung lesen' })).toHaveAttribute('href', '/datenschutz');

    await user.click(screen.getByRole('button', { name: 'Akzeptieren' }));

    expect(acceptConsentMock).toHaveBeenCalledWith('privacy');
  });

  it('links to the privacy policy when it is also pending after the terms update', () => {
    authUser = {
      id: 1,
      email: 'test@example.com',
      pending_consents: ['terms', 'privacy'],
    };

    render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Nutzungsbedingungen lesen' })).toHaveAttribute('href', '/nutzungsbedingungen');
    expect(screen.getByText('Ebenfalls aktualisiert:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Datenschutzerklärung lesen' })).toHaveAttribute('href', '/datenschutz');
  });

  it('is fully keyboard-operable: tab reaches the accept and logout buttons', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    await user.tab();
    expect(screen.getByRole('link', { name: 'Nutzungsbedingungen lesen' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Akzeptieren' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(acceptConsentMock).toHaveBeenCalledWith('terms');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toHaveFocus();
  });

  it('offers a logout option instead of trapping the user', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Abmelden' }));

    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('explains why both actions are disabled while consent is being saved', async () => {
    acceptConsentMock.mockImplementationOnce(() => new Promise(() => undefined));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Akzeptieren' }));

    const acceptingButton = screen.getByRole('button', { name: 'Wird bestätigt…' });
    expect(acceptingButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeDisabled();

    await user.hover(acceptingButton.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Aktion wird gerade verarbeitet.');
  });

  it('shows an error message when accepting fails', async () => {
    acceptConsentMock.mockRejectedValueOnce(new Error('Netzwerkfehler'));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Akzeptieren' }));

    expect(await screen.findByText('Netzwerkfehler')).toBeInTheDocument();
  });

  it('renders nothing when there are no pending consents', () => {
    authUser = { id: 1, email: 'test@example.com', pending_consents: [] };

    const { container } = render(
      <MemoryRouter>
        <ConsentGate />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
