import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RouteErrorBoundary from '../components/runtime/RouteErrorBoundary';
import { watchPageUnload } from '../runtime/chunkLoadErrors';

const reloadPage = vi.hoisted(() => vi.fn());

vi.mock('../runtime/chunkLoadErrors', async () => {
  const actual = await vi.importActual<typeof import('../runtime/chunkLoadErrors')>(
    '../runtime/chunkLoadErrors',
  );
  return { ...actual, reloadPage };
});

function renderBoundary(error: unknown) {
  const router = createMemoryRouter(
    [
      {
        path: '/app/crop-library',
        loader: () => {
          throw error;
        },
        element: null,
        errorElement: <RouteErrorBoundary />,
      },
    ],
    { initialEntries: ['/app/crop-library'] },
  );

  return render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    sessionStorage.clear();
    reloadPage.mockClear();
  });

  it('reloads once when a lazy route chunk fails to load', async () => {
    renderBoundary(new TypeError('Failed to fetch dynamically imported module: /src/crop-library/pages/PublicCropLibraryPage.tsx'));

    await vi.waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Seite neu laden' })).not.toBeInTheDocument();
  });

  it('does not reload a page the user is leaving', async () => {
    const stopWatching = watchPageUnload();
    try {
      window.dispatchEvent(new Event('beforeunload'));
      renderBoundary(new TypeError('Failed to fetch dynamically imported module: /src/crop-library/pages/PublicCropLibraryPage.tsx'));

      await new Promise((resolve) => { setTimeout(resolve, 50); });
      expect(reloadPage).not.toHaveBeenCalled();
    } finally {
      window.dispatchEvent(new Event('pageshow'));
      stopWatching();
    }
  });

  it('offers a manual reload once the automatic retry is used up, without an interim blank state', async () => {
    sessionStorage.setItem('openFarmPlanner.routeLoadRetry./app/crop-library', String(Date.now()));

    renderBoundary(new TypeError('Failed to fetch dynamically imported module: /src/crop-library/pages/PublicCropLibraryPage.tsx'));

    // The boundary seeds `isReloading` from a read-only peek, so the very first
    // committed render already shows the fallback instead of a blank screen.
    expect(await screen.findByRole('button', { name: 'Seite neu laden' })).toBeInTheDocument();
    expect(screen.getByText('Die Anwendung konnte nicht automatisch aktualisiert werden. Bitte lade die Seite neu.')).toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('shows the route fallback without reloading for unrelated route errors', async () => {
    renderBoundary(new Error('Boom'));

    expect(await screen.findByText('Die Seite konnte nicht automatisch wiederhergestellt werden. Bitte lade die Seite neu.')).toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
