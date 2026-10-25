import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicCropTranslationDialog } from '../crop-library/components/PublicCropTranslationDialog';
import type { PublicCrop } from '../api/types';

const mocks = vi.hoisted(() => ({
  getTranslations: vi.fn(),
  updateTranslations: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    publicCropAPI: {
      ...actual.publicCropAPI,
      getTranslations: mocks.getTranslations,
      updateTranslations: mocks.updateTranslations,
    },
  };
});

const crop: PublicCrop = {
  id: 1,
  status: 'published',
  name: 'Tomate',
  variety: 'Roma',
  notes: 'Robuste Sorte.',
  version: 1,
};

describe('PublicCropTranslationDialog', () => {
  beforeEach(() => {
    mocks.getTranslations.mockReset();
    mocks.updateTranslations.mockReset();
  });

  it('leaves the editor empty when the edited language has no translation yet, and shows the German original read-only', async () => {
    mocks.getTranslations.mockResolvedValue({
      data: {
        original_language_code: 'de',
        translations: { de: 'Robuste Sorte.' },
      },
    });

    render(
      <PublicCropTranslationDialog
        open
        crop={crop}
        language="en"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(mocks.getTranslations).toHaveBeenCalledWith(1));

    expect(await screen.findByLabelText('Englisch – Übersetzung')).toHaveValue('');
    expect(screen.getByLabelText('Englisch – Übersetzung')).toHaveAttribute('lang', 'en');
    expect(screen.getByText('Deutsch – Original')).toBeInTheDocument();
    expect(screen.getByText('Robuste Sorte.').closest('[lang]')).toHaveAttribute('lang', 'de');
  });

  it('loads an existing English translation into the editor while keeping the original visible', async () => {
    mocks.getTranslations.mockResolvedValue({
      data: {
        original_language_code: 'de',
        translations: { de: 'Robuste Sorte.', en: 'A robust variety.' },
      },
    });

    render(
      <PublicCropTranslationDialog
        open
        crop={crop}
        language="en"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const textarea = await screen.findByLabelText('Englisch – Übersetzung');
    await waitFor(() => expect(textarea).toHaveValue('A robust variety.'));
    expect(screen.getByText('Robuste Sorte.')).toBeInTheDocument();
  });

  it('saves only the English translation, leaving German untouched', async () => {
    mocks.getTranslations.mockResolvedValue({
      data: {
        original_language_code: 'de',
        translations: { de: 'Robuste Sorte.' },
      },
    });
    mocks.updateTranslations.mockResolvedValue({
      data: { original_language_code: 'de', translations: { de: 'Robuste Sorte.', en: 'A robust variety.' } },
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <PublicCropTranslationDialog
        open
        crop={crop}
        language="en"
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    const textarea = await screen.findByLabelText('Englisch – Übersetzung');
    await user.type(textarea, 'A robust variety.');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(mocks.updateTranslations).toHaveBeenCalledWith(1, { en: 'A robust variety.' }));
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('edits the original-language description by saving only that language key', async () => {
    mocks.getTranslations.mockResolvedValue({
      data: {
        original_language_code: 'de',
        translations: { de: 'Robuste Sorte.', en: 'A robust variety.' },
      },
    });
    mocks.updateTranslations.mockResolvedValue({
      data: { original_language_code: 'de', translations: { de: 'Sehr robuste Sorte.', en: 'A robust variety.' } },
    });
    const user = userEvent.setup();

    render(
      <PublicCropTranslationDialog
        open
        crop={crop}
        language="de"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const textarea = await screen.findByLabelText('Deutsch – Übersetzung');
    await waitFor(() => expect(textarea).toHaveValue('Robuste Sorte.'));
    expect(screen.queryByText('Deutsch – Original')).not.toBeInTheDocument();
    await user.clear(textarea);
    await user.type(textarea, 'Sehr robuste Sorte.');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(mocks.updateTranslations).toHaveBeenCalledWith(1, { de: 'Sehr robuste Sorte.' }));
  });
});
