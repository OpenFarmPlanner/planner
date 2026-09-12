import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNotification } from '../../api/types';
import {
  NOTIFICATION_HISTORY_PAGE_SIZE,
  useNotificationHistory,
} from '../useNotificationHistory';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('../../api/api', () => ({ notificationAPI: { list: listMock } }));

const notification = (id: number, isRead = false): AppNotification => ({
  id,
  notification_type: 'crop_species_proposal_accepted',
  message: `Notification ${id}`,
  context: {},
  target_type: 'crop_species',
  target_id: 1,
  is_read: isRead,
  created_at: '2026-03-15T08:00:00Z',
});

const page = ({
  results = [notification(1), notification(2)],
  count = 2,
  unreadCount = 2,
} = {}) => ({ data: { count, next: null, previous: null, results, unread_count: unreadCount } });

/** Holds a request open so the loading state can be observed mid-flight. */
const pending = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const setup = () => renderHook(() => useNotificationHistory());

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue(page());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the first page', () => {
  it('asks for page one at the shared page size', async () => {
    setup();

    await waitFor(() => expect(listMock).toHaveBeenCalledWith({
      page: 1, page_size: NOTIFICATION_HISTORY_PAGE_SIZE,
    }));
  });

  it('publishes the rows, the unread count and the total', async () => {
    listMock.mockResolvedValue(page({
      results: [notification(1), notification(2), notification(3)],
      count: 47,
      unreadCount: 9,
    }));
    const { result } = setup();

    await waitFor(() => expect(result.current.notifications).toHaveLength(3));
    expect(result.current.unreadCount).toBe(9);
    expect(result.current.totalCount).toBe(47);
  });

  it('starts on page one', () => {
    const { result } = setup();

    expect(result.current.page).toBe(1);
  });

  it('starts empty rather than showing a stale list', () => {
    const { result } = setup();

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.totalCount).toBe(0);
  });

  it('starts loading and unflagged, so the page shows neither an empty state nor an error', () => {
    // The very first render happens before any request has resolved.
    // Reporting "not loading" there would show "keine Benachrichtigungen" for
    // a frame; reporting an error would show the failure banner before
    // anything had a chance to fail.
    const { result } = setup();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasError).toBe(false);
  });

  it('stops loading once the rows arrive', async () => {
    const { result } = setup();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasError).toBe(false);
  });
});

describe('paging', () => {
  it('refetches for the requested page', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.goToPage(3));

    await waitFor(() => expect(listMock).toHaveBeenCalledWith({
      page: 3, page_size: NOTIFICATION_HISTORY_PAGE_SIZE,
    }));
  });

  it('reports the page the user is on', async () => {
    const { result } = setup();

    act(() => result.current.goToPage(2));

    await waitFor(() => expect(result.current.page).toBe(2));
  });

  it('replaces the rows rather than appending them', async () => {
    // This is a paged list, not an infinite scroll.
    const { result } = setup();
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));
    listMock.mockResolvedValue(page({ results: [notification(9)], count: 21, unreadCount: 1 }));

    act(() => result.current.goToPage(2));

    await waitFor(() => expect(result.current.notifications).toEqual([notification(9)]));
  });

  it('does not refetch when asked for the page already shown', async () => {
    const { result } = setup();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    act(() => result.current.goToPage(1));

    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('goes back to loading while the next page is in flight', async () => {
    // The flag is raised in a microtask rather than in the effect body, so
    // the fetch does not set state synchronously during the effect. Its
    // cancelled check is not observable: both the live and the abandoned
    // effect would raise the same flag, so skipping it changes nothing that
    // this suite -- or a user -- can see.

    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const second = pending();
    listMock.mockReturnValue(second.promise);

    act(() => result.current.goToPage(2));

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    await act(async () => {
      second.resolve(page());
      await second.promise;
    });
  });
});

describe('pageCount', () => {
  it('rounds a partial last page up', async () => {
    listMock.mockResolvedValue(page({ count: NOTIFICATION_HISTORY_PAGE_SIZE + 1 }));
    const { result } = setup();

    await waitFor(() => expect(result.current.pageCount).toBe(2));
  });

  it('reports a single page for an exactly full one', async () => {
    // The boundary the ceiling has to get right: a full page must not imply
    // an empty second one.
    listMock.mockResolvedValue(page({ count: NOTIFICATION_HISTORY_PAGE_SIZE }));
    const { result } = setup();

    await waitFor(() => expect(result.current.pageCount).toBe(1));
  });

  it('reports one page when there is nothing at all', async () => {
    // Not zero: the pager renders "1 von 1" rather than collapsing, and a
    // zero would put the page control into an impossible state.
    listMock.mockResolvedValue(page({ results: [], count: 0, unreadCount: 0 }));
    const { result } = setup();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pageCount).toBe(1);
  });

  it('reports one page before anything has loaded', () => {
    const { result } = setup();

    expect(result.current.pageCount).toBe(1);
  });

  it('scales with the total, not with the rows on the current page', async () => {
    // The last page carries fewer rows than the page size; deriving the count
    // from them would shrink the pager the moment the user reached the end.
    listMock.mockResolvedValue(page({ results: [notification(1)], count: 45, unreadCount: 0 }));
    const { result } = setup();

    await waitFor(() => expect(result.current.pageCount).toBe(3));
  });
});

describe('failures', () => {
  it('flags the error instead of throwing', async () => {
    listMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await waitFor(() => expect(result.current.hasError).toBe(true));
  });

  it('stops loading after a failure, so the page can show the error', async () => {
    // Leaving the spinner up would hide the error state behind it forever.
    listMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasError).toBe(true);
  });

  it('clears the error once a later page loads', async () => {
    listMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();
    await waitFor(() => expect(result.current.hasError).toBe(true));
    listMock.mockResolvedValue(page());

    act(() => result.current.goToPage(2));

    await waitFor(() => expect(result.current.hasError).toBe(false));
  });

  it('keeps the rows it already had when a later page fails', async () => {
    // The error banner appears above the list rather than replacing it.
    const { result } = setup();
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));
    listMock.mockRejectedValue(new Error('offline'));

    act(() => result.current.goToPage(2));

    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(result.current.notifications).toHaveLength(2);
  });
});

describe('a request that is no longer wanted', () => {
  it('ignores a page that resolves after the component is gone', async () => {
    // React logs a state update on an unmounted component, and the reason the
    // effect carries a cancelled flag at all.
    const inFlight = pending();
    listMock.mockReturnValue(inFlight.promise);
    const { unmount } = setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    unmount();
    await act(async () => {
      inFlight.resolve(page());
      await inFlight.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('ignores a failure that arrives after the component is gone', async () => {
    const inFlight = pending();
    listMock.mockReturnValue(inFlight.promise);
    const { unmount } = setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    unmount();
    await act(async () => {
      inFlight.reject(new Error('offline'));
      await inFlight.promise.catch(() => {});
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps the newer page when an older request resolves last', async () => {
    // Clicking through the pager faster than the network answers: the first
    // request must not overwrite the page the user is actually on.
    const first = pending();
    listMock.mockReturnValue(first.promise);
    const { result } = setup();
    const second = pending();
    listMock.mockReturnValue(second.promise);

    act(() => result.current.goToPage(2));
    await act(async () => {
      second.resolve(page({ results: [notification(9)], count: 21, unreadCount: 1 }));
      await second.promise;
    });
    await act(async () => {
      first.resolve(page({ results: [notification(1), notification(2)] }));
      await first.promise;
    });

    expect(result.current.notifications).toEqual([notification(9)]);
  });

  it('does not clear the spinner for a page that is still loading', async () => {
    // The abandoned request settles while the page the user is actually on is
    // still in flight. Without the guard its `finally` hides the spinner and
    // the list sits empty with no indication that anything is happening.
    const first = pending();
    listMock.mockReturnValue(first.promise);
    const { result } = setup();
    const second = pending();
    listMock.mockReturnValue(second.promise);

    act(() => result.current.goToPage(2));
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    await act(async () => {
      first.resolve(page());
      await first.promise;
    });

    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      second.resolve(page());
      await second.promise;
    });
  });

  it('does not raise an error banner for a page the user has left', async () => {
    // Clicking past a page whose request then fails: the failure belongs to a
    // page that is no longer shown, so the one that did load must not be
    // covered by its error.
    const first = pending();
    listMock.mockReturnValue(first.promise);
    const { result } = setup();
    const second = pending();
    listMock.mockReturnValue(second.promise);

    act(() => result.current.goToPage(2));
    await act(async () => {
      second.resolve(page({ results: [notification(9)], count: 21, unreadCount: 1 }));
      await second.promise;
    });
    await act(async () => {
      first.reject(new Error('offline'));
      await first.promise.catch(() => {});
    });

    expect(result.current.hasError).toBe(false);
    expect(result.current.notifications).toEqual([notification(9)]);
  });
});

describe('applyRead', () => {
  it('marks the row read without refetching', async () => {
    // The row is opened in place; refetching would reorder the list under
    // the user's cursor.
    const { result } = setup();
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    act(() => result.current.applyRead(notification(1)));

    expect(result.current.notifications[0].is_read).toBe(true);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('marks only the row it was given', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    act(() => result.current.applyRead(notification(1)));

    expect(result.current.notifications[1].is_read).toBe(false);
  });

  it('takes one off the unread count', async () => {
    listMock.mockResolvedValue(page({ unreadCount: 5 }));
    const { result } = setup();
    await waitFor(() => expect(result.current.unreadCount).toBe(5));

    act(() => result.current.applyRead(notification(1)));

    expect(result.current.unreadCount).toBe(4);
  });

  it('does nothing for a row that was already read', async () => {
    // Otherwise reopening a read notification would walk the count down past
    // what is actually unread.
    listMock.mockResolvedValue(page({
      results: [notification(1, true), notification(2)], unreadCount: 1,
    }));
    const { result } = setup();
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    act(() => result.current.applyRead(notification(1, true)));

    expect(result.current.unreadCount).toBe(1);
  });

  it('does not take the count below zero', async () => {
    // The unread count comes from the server and covers every page, so it can
    // legitimately disagree with what this page holds.
    listMock.mockResolvedValue(page({ unreadCount: 0 }));
    const { result } = setup();
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    act(() => result.current.applyRead(notification(1)));

    expect(result.current.unreadCount).toBe(0);
  });

  it('leaves the list alone for a row from another page', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));
    const before = result.current.notifications;

    act(() => result.current.applyRead(notification(404)));

    expect(result.current.notifications.map((entry) => entry.is_read)).toEqual([false, false]);
    expect(result.current.notifications).not.toBe(before);
  });

  it('replaces the row rather than mutating the one it was handed', async () => {
    // The caller keeps its own reference to the notification it opened;
    // mutating it in place would change that object under them.
    const opened = notification(1);
    listMock.mockResolvedValue(page({ results: [opened, notification(2)] }));
    const { result } = setup();
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    act(() => result.current.applyRead(opened));

    expect(opened.is_read).toBe(false);
    expect(result.current.notifications[0]).not.toBe(opened);
  });

  it('keeps a stable identity across renders', async () => {
    // It is handed to each row as a click handler.
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = result.current.applyRead;

    act(() => result.current.goToPage(2));
    await waitFor(() => expect(result.current.page).toBe(2));

    expect(result.current.applyRead).toBe(before);
  });

  it('survives the page changing underneath it', async () => {
    // Reading a row is local state; the next page load overwrites it, which
    // is correct -- the server now knows the row is read.
    const { result } = setup();
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));
    act(() => result.current.applyRead(notification(1)));
    listMock.mockResolvedValue(page({ results: [notification(1, true)], count: 1, unreadCount: 0 }));

    act(() => result.current.goToPage(2));

    await waitFor(() => expect(result.current.notifications).toEqual([notification(1, true)]));
  });
});
