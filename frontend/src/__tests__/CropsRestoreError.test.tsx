import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ReactElement } from 'react';
import Crops from '../pages/Crops';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';

const { historyMock, listAllMock, listMock, restoreMock } = vi.hoisted(() => ({
  historyMock: vi.fn(),
  listAllMock: vi.fn(),
  listMock: vi.fn(),
  restoreMock: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      list: listMock,
      listAll: listAllMock,
      history: historyMock,
      restore: restoreMock,
    },
  };
});

vi.mock('../crops/CropDetail', () => ({
  CropDetail: ({ onOpenHistory }: { onOpenHistory: () => void }): ReactElement => (
    <button type="button" onClick={onOpenHistory}>open-history</button>
  ),
}));

vi.mock('../pages/CropsHistoryDialog', () => ({
  CropsHistoryDialog: ({ open, onRestore }: { open: boolean; onRestore: (id: number) => void }): ReactElement | null => (
    open ? <button type="button" onClick={() => onRestore(7)}>restore-version</button> : null
  ),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, email: 'tester@example.com', display_name: 'Tester' } }),
}));

vi.mock('../hooks/useProjectRequirement', () => ({
  useProjectRequirement: () => ({ shouldShowProjectRequiredState: false, missingProjectReason: null }),
}));

function apiError(status: number, data: unknown): AxiosError {
  const response = { status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } } as AxiosResponse;
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', response.config, undefined, response);
}

function renderCrops(): void {
  render(
    <MemoryRouter initialEntries={['/crops?cropId=1']}>
      <Routes>
        <Route path="/crops" element={<FocusManagerProvider><CommandProvider><Crops /></CommandProvider></FocusManagerProvider>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function restoreAndReadSnackbar(): Promise<HTMLElement> {
  renderCrops();
  fireEvent.click(await screen.findByRole('button', { name: 'open-history' }));
  fireEvent.click(await screen.findByRole('button', { name: 'restore-version' }));
  return screen.findByRole('alert');
}

describe('crop version restore errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    const crops = { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Beet', variety: 'Boltardy', growth_duration_days: 1, harvest_duration_days: 1 }] };
    listMock.mockResolvedValue({ data: crops });
    listAllMock.mockResolvedValue(crops);
    historyMock.mockResolvedValue({ data: [{ history_id: 7 }] });
  });

  it('shows the localized conflict when the restore would duplicate a name and variety', async () => {
    restoreMock.mockRejectedValue(apiError(409, { code: 'crop_variety_conflict', detail: 'conflict' }));
    const alert = await restoreAndReadSnackbar();
    expect(alert).toHaveTextContent('Eine Kultur mit diesem Namen und dieser Sorte existiert in diesem Projekt bereits.');
    expect(restoreMock).toHaveBeenCalledWith(1, 7);
  });

  it('keeps the generic message for unmapped failures', async () => {
    restoreMock.mockRejectedValue(new Error('network'));
    const alert = await restoreAndReadSnackbar();
    expect(alert).toHaveTextContent('Version konnte nicht wiederhergestellt werden');
  });
});
