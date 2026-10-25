import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicCropLibraryDialog } from '../crop-library/components/PublicCropLibraryDialog';
import type { PublicCrop } from '../api/types';
import i18n from '../i18n/config';

const crop: PublicCrop = {
  id: 1,
  status: 'published',
  name: 'Tomate',
  variety: 'Roma',
  growth_duration_days: 70,
  harvest_duration_days: 28,
  version: 1,
};

const lettuceCrop: PublicCrop = {
  id: 2,
  status: 'published',
  name: 'Salat',
  variety: 'Maikönig',
  growth_duration_days: 45,
  harvest_duration_days: 10,
  version: 1,
};

const carrotCrop: PublicCrop = {
  id: 3,
  status: 'published',
  name: 'Möhre',
  variety: 'Nantaise',
  growth_duration_days: 90,
  harvest_duration_days: 21,
  version: 1,
};

const originalMatchMedia = window.matchMedia;

function createMatchMedia(width: number) {
  return vi.fn().mockImplementation((query: string) => {
    const minWidth = query.match(/min-width:\s*(\d+(?:\.\d+)?)px/);
    const maxWidth = query.match(/max-width:\s*(\d+(?:\.\d+)?)px/);
    const matchesMinWidth = !minWidth || width >= Number(minWidth[1]);
    const matchesMaxWidth = !maxWidth || width <= Number(maxWidth[1]);

    return {
      matches: matchesMinWidth && matchesMaxWidth,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
}

function mockMobileViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: createMatchMedia(390),
  });
}

function mockDesktopViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: createMatchMedia(1024),
  });
}

function renderDialog(props: Parameters<typeof PublicCropLibraryDialog>[0]): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <PublicCropLibraryDialog {...props} />
    </MemoryRouter>,
  );
}

describe('PublicCropLibraryDialog', () => {
  beforeEach(() => {
    mockMobileViewport();
    window.sessionStorage.clear();
    window.history.replaceState({ page: 'crops' }, '', '/app/crops');
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('closes the mobile dialog when the browser history entry is popped', async () => {
    const onClose = vi.fn();

    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [crop],
        importingId: null,
        onClose,
        onSearch: vi.fn(),
        onImport: vi.fn(),
      },
    );

    await waitFor(() => {
      expect(window.history.state).toMatchObject({
        openFarmPlannerPublicCropLibrary: expect.any(String),
      });
    });

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe('/app/crops');
    });
  });

  it('closes immediately when the mobile cancel button is clicked', async () => {
    function ClosableDialog() {
      const [open, setOpen] = useState(true);

      return (
        <PublicCropLibraryDialog
          open={open}
          loading={false}
          error={null}
          crops={[crop]}
          importingId={null}
          onClose={() => setOpen(false)}
          onSearch={vi.fn()}
          onImport={vi.fn()}
        />
      );
    }

    render(
      <MemoryRouter>
        <ClosableDialog />
      </MemoryRouter>,
    );

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/app/crops');
    });
  });

  it('uses a full viewport mobile paper with an opaque background', async () => {
    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [crop],
        importingId: null,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport: vi.fn(),
      },
    );

    const dialog = await screen.findByRole('dialog');
    const paper = dialog.closest('.MuiDialog-paper');

    expect(paper).toHaveClass('MuiDialog-paperFullScreen');
    expect(paper).toHaveClass('MuiDialog-paperWidthFalse');
    expect(paper).not.toHaveStyle({ backgroundColor: 'transparent' });
  });

  it('asks for a selection in the detail empty state and keeps the sharing hint secondary', async () => {
    mockDesktopViewport();

    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [crop],
        importingId: null,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport: vi.fn(),
      },
    );

    await screen.findByRole('dialog');

    expect(screen.getByText('Die Kulturbibliothek wächst mit der Community')).toBeInTheDocument();
    expect(screen.getByText('Teile deine bewährten Kulturen und Sorten mit anderen. Je mehr Betriebe mitmachen, desto besser wird die Bibliothek für alle.')).toBeInTheDocument();
    const shareHint = screen.getByText(/^Teile eigene Kulturen/);
    expect(shareHint).toHaveTextContent(
      'Teile eigene Kulturen über das Symbol neben der Kultur in deiner Kulturliste oder mit „In Bibliothek teilen“ in der Kultur.',
    );
    expect(shareHint).toHaveClass('MuiTypography-caption');
    const statusCircle = within(shareHint).getByTestId('crop-library-status-circle');
    expect(statusCircle).toHaveAttribute('data-status', 'notLinked');
    expect(statusCircle).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('MoreVertIcon')).not.toBeInTheDocument();
    expect(screen.queryByText(/⋮|Drei-Punkte|So geht/)).not.toBeInTheDocument();
  });

  it('shows the empty-state text in the single-column layout', async () => {
    mockMobileViewport();

    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [crop],
        importingId: null,
        initialSelectedId: 999,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport: vi.fn(),
      },
    );

    await screen.findByRole('dialog');

    expect(await screen.findByText('Teile deine bewährten Kulturen und Sorten mit anderen. Je mehr Betriebe mitmachen, desto besser wird die Bibliothek für alle.')).toBeInTheDocument();
  });

  it('explains the disabled import button while nothing is selected', async () => {
    mockDesktopViewport();
    const user = userEvent.setup();

    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [crop],
        importingId: null,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport: vi.fn(),
      },
    );

    const importButton = await screen.findByRole('button', { name: 'In Projekt importieren' });
    expect(importButton).toBeDisabled();
    await user.hover(importButton.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Wähle zuerst einen Eintrag aus.');
  });

  it('presents the picker as an import dialog and imports the selected crop', async () => {
    mockDesktopViewport();
    const onImport = vi.fn();

    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [crop],
        importingId: null,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport,
      },
    );

    expect(await screen.findByRole('dialog', { name: 'Aus Kulturbibliothek importieren' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kulturbibliothek öffnen' })).toHaveAttribute('href', '/app/crop-library');
    expect(screen.getByRole('button', { name: 'In Projekt importieren' })).toBeDisabled();

    fireEvent.click(screen.getByRole('option', { name: 'Tomate' }));
    fireEvent.click(screen.getByRole('button', { name: 'In Projekt importieren' }));

    expect(onImport).toHaveBeenCalledWith(crop);
  });

  it('uses localized public crop titles in the picker list and detail pane', async () => {
    mockDesktopViewport();
    const localizedCrop: PublicCrop = {
      ...crop,
      name: 'Ackerbohne',
      variety: 'Hangdown',
      display_name: 'Broad bean',
      display_language_code: 'en',
    };

    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [localizedCrop],
        importingId: null,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport: vi.fn(),
      },
    );

    fireEvent.click(await screen.findByRole('option', { name: /Broad bean/ }));
    expect(screen.getByRole('heading', { level: 6, name: 'Broad bean (Hangdown)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Ackerbohne/ })).not.toBeInTheDocument();
  });

  it('renders the notes like the library detail view, with the fallback hint and lang attribute', async () => {
    mockDesktopViewport();
    await i18n.changeLanguage('en');
    try {
      renderDialog(
        {
          open: true,
          loading: false,
          error: null,
          crops: [{
            ...crop,
            notes: '### Ernte\n\n- Ernte der reifen **Hülsen.**\u200B',
            description: '### Ernte\n\n- Ernte der reifen **Hülsen.**\u200B',
            description_language_code: 'de',
            original_language_code: 'de',
          }],
          importingId: null,
          onClose: vi.fn(),
          onSearch: vi.fn(),
          onImport: vi.fn(),
        },
      );

      fireEvent.click(await screen.findByRole('option', { name: /Tomate/ }));

      expect(screen.getByRole('heading', { level: 6, name: 'Notes' })).toBeInTheDocument();
      expect(screen.getByText('Only available in German')).toBeInTheDocument();
      const bold = screen.getByText('Hülsen.');
      expect(bold.tagName).toBe('STRONG');
      expect(bold.closest('[lang]')).toHaveAttribute('lang', 'de');
      expect(screen.getByRole('heading', { level: 3, name: 'Ernte' })).toBeInTheDocument();
      expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('de');
    }
  });

  it('shows no fallback hint when the notes are in the UI language', async () => {
    mockDesktopViewport();
    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [{ ...crop, description: 'Robuste Sorte.', description_language_code: 'de' }],
        importingId: null,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport: vi.fn(),
      },
    );

    fireEvent.click(await screen.findByRole('option', { name: /Tomate/ }));

    expect(screen.getByText('Robuste Sorte.')).toBeInTheDocument();
    expect(screen.queryByText(/Nur auf .* verfügbar/)).not.toBeInTheDocument();
  });

  it('supports keyboard navigation in the desktop import list', async () => {
    mockDesktopViewport();
    const user = userEvent.setup();
    const onImport = vi.fn();

    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [crop, lettuceCrop, carrotCrop],
        importingId: null,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport,
      },
    );

    expect(await screen.findByRole('dialog', { name: 'Aus Kulturbibliothek importieren' })).toBeInTheDocument();

    // Each fixture crop is its own single-variety group with no general
    // entry, so the keyboard flow mirrors the full public crop library page:
    // Enter opens a group, arrows then move through the visible rows.
    screen.getByRole('option', { name: 'Tomate' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: 'Tomate (Roma)' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('heading', { level: 6, name: 'Tomate (Roma)' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Salat' })).toHaveFocus();
    });

    await user.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: 'Salat (Maikönig)' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('heading', { level: 6, name: 'Salat (Maikönig)' })).toBeInTheDocument();

    await user.keyboard('{End}');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Möhre' })).toHaveFocus();
    });

    await user.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: 'Möhre (Nantaise)' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('heading', { level: 6, name: 'Möhre (Nantaise)' })).toBeInTheDocument();

    await user.keyboard('{Home}');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tomate' })).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('heading', { level: 6, name: 'Tomate (Roma)' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tomate (Roma)' })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole('button', { name: 'In Projekt importieren' }));
    expect(onImport).toHaveBeenCalledWith(crop);
  });

  it('keeps list navigation scoped away from the import dialog search field', async () => {
    mockDesktopViewport();
    const user = userEvent.setup();

    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [crop, lettuceCrop],
        importingId: null,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport: vi.fn(),
      },
    );

    await screen.findByRole('dialog', { name: 'Aus Kulturbibliothek importieren' });
    const searchInput = screen.getByLabelText('Öffentliche Kulturen durchsuchen');
    searchInput.focus();

    await user.keyboard('{ArrowDown}');

    expect(screen.getByText('Die Kulturbibliothek wächst mit der Community')).toBeInTheDocument();
    expect(searchInput).toHaveFocus();
  });

  it('shows the community contribution empty state on mobile when the library is empty', async () => {
    renderDialog(
      {
        open: true,
        loading: false,
        error: null,
        crops: [],
        importingId: null,
        onClose: vi.fn(),
        onSearch: vi.fn(),
        onImport: vi.fn(),
      },
    );

    await screen.findByRole('dialog');

    expect(screen.getByText('Noch keine öffentlichen Kulturen vorhanden')).toBeInTheDocument();
    expect(screen.getByText(/Die Kulturbibliothek lebt von den Beiträgen der Community/)).toBeInTheDocument();
  });
});
