import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { ReactElement } from 'react';
import Crops from '../pages/Crops';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';

const {
  formCropIdHistory,
  listAllMock,
  listMock,
  selectedIdHistory,
} = vi.hoisted(() => ({
  formCropIdHistory: [] as Array<number | undefined>,
  listAllMock: vi.fn(),
  listMock: vi.fn(),
  selectedIdHistory: [] as Array<number | undefined>,
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      list: listMock,
      listAll: listAllMock,
    },
  };
});

vi.mock('../crops/CropDetail', () => ({
  CropDetail: ({ selectedCropId, onCropSelect }: {
    selectedCropId?: number;
    onCropSelect: (crop: { id?: number } | null) => void;
  }): ReactElement => {
    selectedIdHistory.push(selectedCropId);

    return (
      <div>
        <span data-testid="selected-crop-id">{selectedCropId ?? 'none'}</span>
        <button type="button" onClick={() => onCropSelect({ id: 2 })}>
          select-crop-2
        </button>
      </div>
    );
  },
}));

vi.mock('../crops/CropForm', () => ({
  CropForm: ({ crop }: { crop?: { id?: number } }): ReactElement => {
    formCropIdHistory.push(crop?.id);

    return <div data-testid="crop-form">crop-form-{crop?.id ?? 'new'}</div>;
  },
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 1, email: 'tester@example.com', display_name: 'Tester' },
  }),
}));

vi.mock('../hooks/useProjectRequirement', () => ({
  useProjectRequirement: () => ({
    shouldShowProjectRequiredState: false,
    missingProjectReason: null,
  }),
}));

function SearchIndicator(): ReactElement {
  const location = useLocation();
  return <span data-testid="location-search">{location.search}</span>;
}

function renderCrops(initialEntry = '/crops'): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/crops"
          element={(
            <>
              <SearchIndicator />
              <FocusManagerProvider><CommandProvider><Crops /></CommandProvider></FocusManagerProvider>
            </>
          )}
        />
        <Route path="/locations" element={<div data-testid="locations-page">locations</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function CrossRouteHarness(): ReactElement {
  return (
    <>
      <Link to="/locations">go-locations</Link>
      <SearchIndicator />
      <FocusManagerProvider><CommandProvider><Crops /></CommandProvider></FocusManagerProvider>
    </>
  );
}

describe('Crops selection persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formCropIdHistory.length = 0;
    selectedIdHistory.length = 0;
    localStorage.clear();

    listMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Tomate', growth_duration_days: 1, harvest_duration_days: 1 },
          { id: 2, name: 'Kartoffel', growth_duration_days: 1, harvest_duration_days: 1 },
        ],
      },
    });
    listAllMock.mockImplementation(async () => (await listMock()).data);
  });

  it('loads crops beyond the first API page', async () => {
    const crops = Array.from({ length: 150 }, (_, index) => ({
      id: index + 1, name: `Kultur ${index + 1}`, growth_duration_days: 1, harvest_duration_days: 1,
    }));
    listMock.mockResolvedValue({
      data: { count: 150, next: '/crops/?page=2', previous: null, results: crops.slice(0, 100) },
    });
    listAllMock.mockResolvedValue({ count: 150, next: null, previous: null, results: crops });

    renderCrops('/crops?cropId=150');

    await waitFor(() => {
      expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('150');
    }, { timeout: 3000 });
    expect(listAllMock).toHaveBeenCalled();
  });

  it('restores initial selection from query parameter once', async () => {
    localStorage.setItem('selectedCropId', '2');

    renderCrops('/crops?cropId=1');

    await waitFor(() => {
      expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('1');
    }, { timeout: 3000 });

    expect(screen.getByTestId('location-search')).toHaveTextContent('?cropId=1');
    expect(localStorage.getItem('selectedCropId')).toBe('1');
    expect(selectedIdHistory).not.toContain(undefined);
  });

  it('opens edit dialog from explicit url action and removes only the action parameter', async () => {
    renderCrops('/crops?cropId=1&action=edit');

    await waitFor(() => {
      expect(screen.getByTestId('crop-form')).toHaveTextContent('crop-form-1');
    }, { timeout: 3000 });

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?cropId=1');
    }, { timeout: 3000 });

    expect(formCropIdHistory[0]).toBe(1);
  });

  it('persists user selection to url and localStorage', async () => {
    renderCrops('/crops?cropId=1');

    await waitFor(() => {
      expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('1');
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'select-crop-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('2');
    }, { timeout: 3000 });

    expect(screen.getByTestId('location-search')).toHaveTextContent('?cropId=2');
    expect(localStorage.getItem('selectedCropId')).toBe('2');
  });

  it('restores selection from localStorage when returning without query parameter', async () => {
    localStorage.setItem('selectedCropId', '2');

    renderCrops('/crops');

    await waitFor(() => {
      expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('2');
    }, { timeout: 3000 });

    expect(screen.getByTestId('location-search')).toHaveTextContent('?cropId=2');
    expect(localStorage.getItem('selectedCropId')).toBe('2');
  });

  it('does not flip back to previous selection after user change', async () => {
    renderCrops('/crops?cropId=1');

    await waitFor(() => {
      expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('1');
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'select-crop-2' }));

    await waitFor(() => {
      expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('2');
    }, { timeout: 3000 });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const firstSelectionOfTwo = selectedIdHistory.findIndex((value) => value === 2);
    const valuesAfterSelectingTwo = selectedIdHistory.slice(firstSelectionOfTwo);

    expect(firstSelectionOfTwo).toBeGreaterThan(-1);
    expect(valuesAfterSelectingTwo).not.toContain(1);
  });

  it('does not navigate back to crops after leaving the route', async () => {
    render(
      <MemoryRouter initialEntries={['/crops?cropId=1']}>
        <Routes>
          <Route path="/crops" element={<CrossRouteHarness />} />
          <Route path="/locations" element={<div data-testid="locations-page">locations</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('1');
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole('link', { name: 'go-locations' }));

    await waitFor(() => {
      expect(screen.getByTestId('locations-page')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.queryByTestId('selected-crop-id')).not.toBeInTheDocument();
  });
});
