import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDialogEditCellKey,
  createDialogEditCellRequests,
  DialogEditCellContext,
  useDialogEditCellOpenRequest,
} from '../components/data-grid/DialogEditCellContext';

function Probe({ rowId, field, onOpen, onRender }: {
  rowId?: string | number;
  field?: string;
  onOpen: (query?: string) => void;
  onRender?: () => void;
}) {
  onRender?.();
  useDialogEditCellOpenRequest(rowId, field, onOpen);
  return null;
}

describe('dialog editor requests', () => {
  it('builds a stable key from the cell identity', () => {
    expect(buildDialogEditCellKey(7, 'bed')).toBe('7:bed');
    expect(buildDialogEditCellKey('7', 'bed')).toBe('7:bed');
  });

  it('consumes an outstanding request when the target mounts and never replays it after a remount', () => {
    const requests = createDialogEditCellRequests();
    const onOpen = vi.fn();
    requests.open(7, 'bed', 'a');
    const cell = <DialogEditCellContext.Provider value={requests}>
      <Probe rowId={7} field="bed" onOpen={onOpen} />
    </DialogEditCellContext.Provider>;
    const view = render(cell);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('a');
    expect(requests.getRequest('7:bed')).toBeNull();

    view.rerender(<></>);
    view.rerender(cell);
    expect(onOpen).toHaveBeenCalledTimes(1);

    act(() => requests.open(7, 'bed', 'b'));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith('b');
  });

  it('opens only the target editor without rendering unrelated cells', () => {
    const requests = createDialogEditCellRequests();
    const target = vi.fn();
    const unrelatedOpen = vi.fn();
    const unrelatedRender = vi.fn();
    render(<DialogEditCellContext.Provider value={requests}>
      <Probe rowId={7} field="bed" onOpen={target} />
      <Probe rowId={8} field="bed" onOpen={unrelatedOpen} onRender={unrelatedRender} />
      <Probe onOpen={unrelatedOpen} onRender={unrelatedRender} />
    </DialogEditCellContext.Provider>);
    unrelatedRender.mockClear();

    act(() => requests.open(7, 'bed'));
    expect(target).toHaveBeenCalledTimes(1);
    expect(unrelatedOpen).not.toHaveBeenCalled();
    expect(unrelatedRender).not.toHaveBeenCalled();
  });

  it('keeps a newer pending request when an older token is consumed', () => {
    const requests = createDialogEditCellRequests();
    requests.open(7, 'bed');
    const original = requests.getRequest('7:bed')!;
    requests.open(8, 'bed');
    requests.consumeRequest(original.token);
    expect(requests.getRequest('7:bed')).toBeNull();
    expect(requests.getRequest('8:bed')?.token).toBeGreaterThan(original.token);
  });
});
