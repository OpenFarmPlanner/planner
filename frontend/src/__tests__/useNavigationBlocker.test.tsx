import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useNavigationBlocker } from '../hooks/useNavigationBlocker';
import type { Mock } from 'vitest';

const { useBlockerMock } = vi.hoisted(() => ({
  useBlockerMock: vi.fn(),
}));

vi.mock('react-router', () => ({
  useBlocker: useBlockerMock,
}));

function TestComponent({
  shouldBlock,
  message,
  onProceed,
  confirmBeforeProceed,
}: {
  shouldBlock: boolean;
  message?: string;
  onProceed?: () => Promise<void | boolean> | void | boolean;
  confirmBeforeProceed?: boolean;
}) {
  useNavigationBlocker(shouldBlock, message, onProceed, confirmBeforeProceed);
  return null;
}

describe('useNavigationBlocker', () => {
  const defaultBlocker = {
    state: 'unblocked',
    proceed: vi.fn(),
    reset: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useBlockerMock.mockReturnValue(defaultBlocker);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers and cleans up beforeunload handler when blocking is enabled', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { rerender, unmount } = render(
      <TestComponent shouldBlock={true} message="Custom warning" />
    );

    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    const beforeUnloadHandler = addSpy.mock.calls.find(([event]) => event === 'beforeunload')?.[1] as EventListener;
    const event = new Event('beforeunload') as BeforeUnloadEvent;

    const returnMessage = beforeUnloadHandler(event);
    expect(returnMessage).toBe('Custom warning');

    rerender(<TestComponent shouldBlock={false} message="Custom warning" />);
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    unmount();
  });

  it('passes correct route-change predicate to useBlocker', () => {
    render(<TestComponent shouldBlock={true} />);

    const predicate = (useBlockerMock as Mock).mock.calls[0][0] as (args: {
      currentLocation: { pathname: string };
      nextLocation: { pathname: string };
    }) => boolean;

    expect(
      predicate({
        currentLocation: { pathname: '/crops' },
        nextLocation: { pathname: '/crops' },
      })
    ).toBe(false);

    expect(
      predicate({
        currentLocation: { pathname: '/crops' },
        nextLocation: { pathname: '/fields-beds' },
      })
    ).toBe(true);
  });

  it('handles blocked state by confirming and proceeding or resetting', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');

    useBlockerMock.mockReturnValueOnce({
      state: 'blocked',
      proceed: vi.fn(),
      reset: vi.fn(),
    });

    confirmSpy.mockReturnValueOnce(true);
    const { rerender } = render(<TestComponent shouldBlock={true} message="Unsaved" />);

    const firstBlocker = (useBlockerMock as Mock).mock.results[0].value;
    expect(confirmSpy).toHaveBeenCalledWith('Unsaved');
    expect(firstBlocker.proceed).toHaveBeenCalledTimes(1);
    expect(firstBlocker.reset).not.toHaveBeenCalled();

    useBlockerMock.mockReturnValueOnce({
      state: 'blocked',
      proceed: vi.fn(),
      reset: vi.fn(),
    });

    confirmSpy.mockReturnValueOnce(false);
    rerender(<TestComponent shouldBlock={true} message="Unsaved" />);

    const secondBlocker = (useBlockerMock as Mock).mock.results[1].value;
    expect(secondBlocker.proceed).not.toHaveBeenCalled();
    expect(secondBlocker.reset).toHaveBeenCalledTimes(1);
  });

  it('awaits onProceed (e.g. saving in-progress edits) before proceeding, so confirming does not silently discard them', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    let resolveSave: () => void = () => {};
    const onProceed = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));

    useBlockerMock.mockReturnValueOnce({
      state: 'blocked',
      proceed: vi.fn(),
      reset: vi.fn(),
    });

    render(<TestComponent shouldBlock={true} message="Unsaved" onProceed={onProceed} />);
    const blocker = (useBlockerMock as Mock).mock.results[0].value;

    expect(confirmSpy).toHaveBeenCalledWith('Unsaved');
    expect(onProceed).toHaveBeenCalledTimes(1);
    // Navigation must wait for the save to finish, not fire immediately.
    expect(blocker.proceed).not.toHaveBeenCalled();

    resolveSave();
    await vi.waitFor(() => expect(blocker.proceed).toHaveBeenCalledTimes(1));
  });

  it('can save and proceed without showing a confirmation dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const onProceed = vi.fn();

    useBlockerMock.mockReturnValueOnce({
      state: 'blocked',
      proceed: vi.fn(),
      reset: vi.fn(),
    });

    render(
      <TestComponent
        shouldBlock={true}
        message="Unsaved"
        onProceed={onProceed}
        confirmBeforeProceed={false}
      />,
    );
    const blocker = (useBlockerMock as Mock).mock.results[0].value;

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(blocker.proceed).toHaveBeenCalledTimes(1));
    expect(blocker.reset).not.toHaveBeenCalled();
  });

  it('stays on the current route when saving is required and fails', async () => {
    const blocker = {
      state: 'blocked', proceed: vi.fn(), reset: vi.fn(),
      location: { pathname: '/app/planting-plans/4' },
    };
    useBlockerMock.mockReturnValueOnce(blocker);
    const save = vi.fn(async () => false);

    render(<TestComponent shouldBlock onProceed={save} confirmBeforeProceed={false} />);

    expect(save).toHaveBeenCalledWith(blocker.location);
    await vi.waitFor(() => expect(blocker.reset).toHaveBeenCalledTimes(1));
    expect(blocker.proceed).not.toHaveBeenCalled();
  });

  it('does not show another confirmation dialog when onProceed triggers a rerender while still blocked', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let resolveSave: () => void = () => {};
    const onProceed = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const firstBlocker = {
      state: 'blocked',
      proceed: vi.fn(),
      reset: vi.fn(),
    };
    const secondBlocker = {
      state: 'blocked',
      proceed: vi.fn(),
      reset: vi.fn(),
    };

    useBlockerMock.mockReturnValueOnce(firstBlocker).mockReturnValueOnce(secondBlocker);

    const { rerender } = render(<TestComponent shouldBlock={true} message="Unsaved" onProceed={onProceed} />);
    rerender(<TestComponent shouldBlock={true} message="Unsaved" onProceed={onProceed} />);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(firstBlocker.proceed).not.toHaveBeenCalled();
    expect(secondBlocker.proceed).not.toHaveBeenCalled();

    resolveSave();
    await vi.waitFor(() => expect(firstBlocker.proceed).toHaveBeenCalledTimes(1));
    expect(secondBlocker.proceed).not.toHaveBeenCalled();
  });

  it('proceeds even if onProceed rejects, so a save failure cannot trap the user on the page', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const onProceed = vi.fn(() => Promise.reject(new Error('save failed')));

    useBlockerMock.mockReturnValueOnce({
      state: 'blocked',
      proceed: vi.fn(),
      reset: vi.fn(),
    });

    render(<TestComponent shouldBlock={true} message="Unsaved" onProceed={onProceed} />);
    const blocker = (useBlockerMock as Mock).mock.results[0].value;

    await vi.waitFor(() => expect(blocker.proceed).toHaveBeenCalledTimes(1));
  });
});
