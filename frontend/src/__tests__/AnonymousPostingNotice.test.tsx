import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';
import { AuthApiError } from '../auth/authApi';
import { AnonymousPostingNotice } from '../crop-library/components/publicCropLibrary/AnonymousPostingNotice';

const mocks = vi.hoisted(() => ({
  refreshUser: vi.fn(async () => null),
  updatePublicDisplayName: vi.fn(),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ refreshUser: mocks.refreshUser }),
}));

vi.mock('../auth/authApi', async () => {
  const actual = await vi.importActual<typeof import('../auth/authApi')>('../auth/authApi');
  return { ...actual, updatePublicDisplayName: mocks.updatePublicDisplayName };
});

const fixedT = i18n.getFixedT('de', 'crops');
const t = (key: string, options?: Record<string, unknown>) => fixedT(key, options) as string;

const setup = () => {
  const onSaved = vi.fn();
  render(<AnonymousPostingNotice t={t} onSaved={onSaved} />);
  return { onSaved, user: userEvent.setup() };
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('de');
});

describe('AnonymousPostingNotice', () => {
  it('explains the numbered pseudonym without forcing a name', () => {
    setup();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Du schreibst als Anonym. Andere sehen dich in diesem Thema als „Anonym“ mit einer Nummer.',
    );
    expect(screen.getByRole('button', { name: 'Öffentlichen Namen festlegen' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('saves the public name inline, refreshes the user and reloads the discussion', async () => {
    mocks.updatePublicDisplayName.mockResolvedValue({ detail: 'ok', user: {} });
    const { onSaved, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Öffentlichen Namen festlegen' }));
    expect(screen.getByText(
      'Wird öffentlich als Autor deiner Beiträge in der Kulturbibliothek angezeigt, auch bei deinen bisherigen Beiträgen.',
    )).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Öffentlicher Name' }), '  Grüner Hof ');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(mocks.updatePublicDisplayName).toHaveBeenCalledWith('Grüner Hof');
    expect(mocks.refreshUser).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows a backend validation error at the field', async () => {
    mocks.updatePublicDisplayName.mockRejectedValue(new AuthApiError('x', {
      status: 400,
      payload: { public_display_name: ['Dieser Name ist reserviert. Bitte wähle einen anderen.'] },
    }));
    const { onSaved, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Öffentlichen Namen festlegen' }));
    await user.type(screen.getByRole('textbox', { name: 'Öffentlicher Name' }), 'Anonym 3');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    const field = screen.getByRole('textbox', { name: 'Öffentlicher Name' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Dieser Name ist reserviert. Bitte wähle einen anderen.');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('closes the field again on cancel', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: 'Öffentlichen Namen festlegen' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
