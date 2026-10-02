import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountSettingsCropLibraryTokenCard from '../pages/accountSettingsCropLibraryTokenCard';
import type { CropLibraryToken, CropLibraryTokenCreated } from '../api/types';

const authUser: { is_superuser: boolean } = { is_superuser: true };

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: authUser }),
}));

const listMock = vi.fn();
const createMock = vi.fn();
const revokeMock = vi.fn();

vi.mock('../api/api', () => ({
  cropLibraryTokenAPI: {
    list: () => listMock(),
    create: (payload: unknown) => createMock(payload),
    revoke: (id: number) => revokeMock(id),
  },
}));

function token(overrides: Partial<CropLibraryToken> = {}): CropLibraryToken {
  return {
    id: 10,
    name: 'crop-data sync',
    scope: 'read',
    token_prefix: 'abcd1234',
    status: 'active',
    created_at: '2026-07-01T10:00:00Z',
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function createdToken(overrides: Partial<CropLibraryTokenCreated> = {}): CropLibraryTokenCreated {
  return { ...token(), token: 'ofp_clt_plaintext-shown-once', ...overrides };
}

describe('AccountSettingsCropLibraryTokenCard', () => {
  beforeEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    revokeMock.mockReset();
    authUser.is_superuser = true;
  });

  it('renders nothing for a non-superuser', () => {
    authUser.is_superuser = false;

    const { container } = render(<AccountSettingsCropLibraryTokenCard />);

    expect(container).toBeEmptyDOMElement();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('links to the API documentation in a new tab', async () => {
    listMock.mockResolvedValue({ data: [] });

    render(<AccountSettingsCropLibraryTokenCard />);

    const docsLink = await screen.findByRole('link', { name: 'Dokumentation öffnen' });
    // Deliberately not the generic /api/docs/ reference: the crop-library
    // token's endpoints are excluded from that generated schema.
    expect(docsLink.getAttribute('href')).toBe(
      'https://github.com/OpenFarmPlanner/planner/blob/main/docs/crop-library-api-tokens.md',
    );
    expect(docsLink).toHaveAttribute('target', '_blank');
    expect(docsLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('lists an existing token with its scope and status, with no project column', async () => {
    listMock.mockResolvedValue({ data: [token({ scope: 'write' })] });

    render(<AccountSettingsCropLibraryTokenCard />);

    expect(await screen.findByText('crop-data sync')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Rechte' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Projekt' })).not.toBeInTheDocument();
    expect(screen.getByText('Lesen und schreiben')).toBeInTheDocument();
  });

  it('keeps expired and revoked tokens collapsed below active tokens by default', async () => {
    const user = userEvent.setup();
    const revokedToken = token({ id: 11, name: 'Old token', status: 'revoked', revoked_at: '2026-07-15T08:00:00Z' });
    listMock.mockResolvedValue({ data: [token(), revokedToken] });

    render(<AccountSettingsCropLibraryTokenCard />);

    expect(await screen.findByText('crop-data sync')).toBeInTheDocument();
    expect(screen.queryByText('Old token')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Abgelaufene und widerrufene Tokens anzeigen (1)' });
    await user.click(toggle);

    expect(await screen.findByText('Old token')).toBeInTheDocument();
  });

  it('shows an empty state when there is no token yet', async () => {
    listMock.mockResolvedValue({ data: [] });

    render(<AccountSettingsCropLibraryTokenCard />);

    expect(await screen.findByText('Es wurde noch kein Kulturbibliothek-Token erstellt.')).toBeInTheDocument();
  });

  it('creates a write-scoped token and shows the plaintext exactly once', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ data: [] });
    createMock.mockResolvedValue({ data: createdToken({ scope: 'write' }) });

    render(<AccountSettingsCropLibraryTokenCard />);
    await screen.findByText('Es wurde noch kein Kulturbibliothek-Token erstellt.');

    await user.click(screen.getByRole('button', { name: 'Token erstellen' }));
    await user.type(screen.getByLabelText('Name'), 'crop-data sync');
    await user.click(screen.getByRole('combobox', { name: 'Berechtigungen' }));
    await user.click(await screen.findByRole('option', { name: 'Lesen und schreiben' }));
    await user.click(screen.getAllByRole('button', { name: 'Token erstellen' })[0]);

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({ name: 'crop-data sync', scope: 'write', expires_at: null });

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/nur dieses eine Mal angezeigt und kann danach nicht erneut abgerufen werden/),
    ).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('ofp_clt_plaintext-shown-once')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Ich habe das Token gespeichert' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('never renders a full token value in the list', async () => {
    listMock.mockResolvedValue({ data: [token()] });

    render(<AccountSettingsCropLibraryTokenCard />);

    await screen.findByText('crop-data sync');
    expect(screen.queryByText(/ofp_clt_/)).not.toBeInTheDocument();
  });

  it('revokes a token and reloads the list', async () => {
    const user = userEvent.setup();
    listMock
      .mockResolvedValueOnce({ data: [token()] })
      .mockResolvedValueOnce({ data: [token({ status: 'revoked' })] });
    revokeMock.mockResolvedValue({ data: token({ status: 'revoked' }) });

    render(<AccountSettingsCropLibraryTokenCard />);
    await screen.findByText('crop-data sync');

    await user.click(screen.getByRole('button', { name: 'Widerrufen' }));

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith(10));
    expect(
      screen.getByRole('button', { name: 'Abgelaufene und widerrufene Tokens anzeigen (1)' }),
    ).toBeInTheDocument();
  });

  it('surfaces a creation error instead of pretending the token exists', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ data: [] });
    createMock.mockRejectedValue(new Error('boom'));

    render(<AccountSettingsCropLibraryTokenCard />);
    await screen.findByText('Es wurde noch kein Kulturbibliothek-Token erstellt.');

    await user.click(screen.getByRole('button', { name: 'Token erstellen' }));
    await user.type(screen.getByLabelText('Name'), 'crop-data sync');
    await user.click(screen.getAllByRole('button', { name: 'Token erstellen' })[0]);

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
