import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useParcelRotationGroups } from '../components/hierarchy/rotation/useParcelRotationGroups';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return { ...actual, parcelRotationAPI: { ...actual.parcelRotationAPI, list: listMock } };
});

const group = { id: 5, name: 'Nord–Süd', parcels: [{ id: 10, name: 'Tunnel', beds: [] }] };
const deferred = () => {
  let resolve: (value: { data: typeof group[] }) => void = () => undefined;
  const promise = new Promise<{ data: typeof group[] }>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('useParcelRotationGroups (#1576)', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('clears the dialog loading state when a newer load supersedes the one started by opening it', async () => {
    const openLoad = deferred();
    const retryLoad = deferred();
    listMock.mockResolvedValueOnce({ data: [group] })
      .mockReturnValueOnce(openLoad.promise)
      .mockReturnValueOnce(retryLoad.promise);
    const { result } = renderHook(() => useParcelRotationGroups({ enabled: true, fields: [], beds: [] }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => { result.current.open(10); });
    act(() => { result.current.reload(); });
    await act(async () => {
      retryLoad.resolve({ data: [group] });
      openLoad.resolve({ data: [group] });
    });

    render(<>{result.current.dialog}</>);
    expect(screen.getByRole('dialog', { name: 'Rotationsgruppen verwalten' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Gruppenname' })).toHaveValue('Nord–Süd');
  });
});
