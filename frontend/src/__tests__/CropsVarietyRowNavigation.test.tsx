import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router';
import type { ReactElement } from 'react';
import Crops from '../pages/Crops';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';

const { listMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      list: listMock,
      listAll: async () => (await listMock()).data,
    },
  };
});

vi.mock('../crops/CropForm', () => ({
  CropForm: (): ReactElement => <div data-testid="crop-form" />,
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

function NavigationObserver(): ReactElement {
  const navigationType = useNavigationType();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="nav-type">{navigationType}</span>
      <span data-testid="nav-search">{location.search}</span>
      <button type="button" onClick={() => navigate(-1)}>go-back</button>
    </div>
  );
}

function renderCrops(initialEntry: string): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <NavigationObserver />
      <FocusManagerProvider><CommandProvider><Crops /></CommandProvider></FocusManagerProvider>
    </MemoryRouter>
  );
}

describe('Varieties table row navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    listMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Carrot', variety: '', growth_duration_days: 1, harvest_duration_days: 1 },
          {
            id: 2, name: 'Carrot', variety: 'Nantaise', growth_duration_days: 1, harvest_duration_days: 1,
            row_spacing_cm: 30,
          },
        ],
      },
    });
  });

  it('pushes a new history entry when navigating to a variety via a table row click', async () => {
    renderCrops('/crops?cropId=1');

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByText('Nantaise').closest('.variety-row') as HTMLElement);

    await waitFor(() => {
      expect(screen.getByTestId('nav-search')).toHaveTextContent('cropId=2');
    });
    expect(screen.getByTestId('nav-type')).toHaveTextContent('PUSH');
  });

  it('returns to the crop page when going back after a table row click (real back-button behavior)', async () => {
    renderCrops('/crops?cropId=1');

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByText('Nantaise').closest('.variety-row') as HTMLElement);

    await waitFor(() => {
      expect(screen.getByTestId('nav-search')).toHaveTextContent('cropId=2');
    });

    fireEvent.click(screen.getByRole('button', { name: 'go-back' }));

    await waitFor(() => {
      expect(screen.getByTestId('nav-search')).toHaveTextContent('cropId=1');
    });
  });
});
