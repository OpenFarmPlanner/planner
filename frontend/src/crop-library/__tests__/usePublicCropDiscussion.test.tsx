import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PublicCropDiscussionComment,
  PublicCropDiscussionTopic,
  PublicCropRevision,
} from '../../api/types';
import type { WebSocketEvent } from '../../realtime/useWebSocket';
import { usePublicCropDiscussion } from '../hooks/usePublicCropDiscussion';

const { topicsMock, commentsMock, versionsMock, socketOptions } = vi.hoisted(() => ({
  topicsMock: vi.fn(),
  commentsMock: vi.fn(),
  versionsMock: vi.fn(),
  socketOptions: { current: null as null | {
    path: string | null;
    onEvent: (event: WebSocketEvent) => void;
    onFallbackPoll: () => void;
  } },
}));

vi.mock('../../api/api', () => ({
  publicCropAPI: {
    discussionTopics: topicsMock,
    discussionComments: commentsMock,
    versions: versionsMock,
  },
}));

/**
 * The socket itself is replaced, but its options are captured so the tests can
 * drive the two ways it feeds the hook: a live event and the fallback poll.
 * Standing up a real WebSocket would test the transport, not this hook.
 */
vi.mock('../../realtime/useWebSocket', () => ({
  useWebSocket: (options: NonNullable<typeof socketOptions.current>) => {
    socketOptions.current = options;
  },
}));

const topic = (id: number, overrides: Partial<PublicCropDiscussionTopic> = {}): PublicCropDiscussionTopic => ({
  id, public_crop: 1, title: `Thema ${id}`, comment_count: 1, ...overrides,
});

const comment = (id: number, topicId = 10): PublicCropDiscussionComment => ({
  id, topic: topicId, body: `Kommentar ${id}`, is_edited: false, can_edit: false,
} as PublicCropDiscussionComment);

const revision = (id: number): PublicCropRevision => ({
  id, public_crop: 1, version: id,
} as PublicCropRevision);

const TOPICS = [topic(10), topic(11)];
const COMMENTS = [comment(100), comment(101)];
const VERSIONS = [revision(1)];

interface Props {
  cropId: number | null;
  topicId: number | null;
  liveUpdates?: boolean;
}

const setup = (initialProps: Props = { cropId: 1, topicId: null }) => {
  const onSelectedTopicMissing = vi.fn();
  const view = renderHook(
    (props: Props) => usePublicCropDiscussion({
      cropId: props.cropId,
      topicId: props.topicId,
      liveUpdates: props.liveUpdates ?? true,
      onSelectedTopicMissing,
    }),
    { initialProps },
  );
  return { ...view, onSelectedTopicMissing };
};

/** Holds a request open so an in-flight load can be observed or overtaken. */
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  socketOptions.current = null;
  topicsMock.mockResolvedValue({ data: TOPICS });
  commentsMock.mockResolvedValue({ data: COMMENTS });
  versionsMock.mockResolvedValue({ data: VERSIONS });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading a crop', () => {
  it('loads its topics and versions', async () => {
    const { result } = setup();

    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    expect(result.current.topics).toEqual(TOPICS);
    expect(result.current.versions).toEqual(VERSIONS);
  });

  it('reports loading while the request is in flight', async () => {
    const topicsRequest = pending<{ data: PublicCropDiscussionTopic[] }>();
    topicsMock.mockReturnValue(topicsRequest.promise);
    const { result } = setup();

    await waitFor(() => expect(result.current.collaborationStatus).toBe('loading'));

    await act(async () => {
      topicsRequest.resolve({ data: TOPICS });
      await topicsRequest.promise;
    });
  });

  it('asks for both in parallel rather than one after the other', async () => {
    // The version list is not needed to render the topics, so serialising
    // them would add a round trip to every crop opened. The *topics* request
    // is the one held open: if the two were sequential, the versions call
    // would not have been made yet while it is outstanding.
    const topicsRequest = pending<{ data: PublicCropDiscussionTopic[] }>();
    topicsMock.mockReturnValue(topicsRequest.promise);
    setup();

    await waitFor(() => expect(topicsMock).toHaveBeenCalled());
    expect(versionsMock).toHaveBeenCalled();

    await act(async () => {
      topicsRequest.resolve({ data: TOPICS });
      await topicsRequest.promise;
    });
  });

  it('starts idle with nothing loaded', () => {
    const { result } = setup({ cropId: null, topicId: null });

    expect(result.current.collaborationStatus).toBe('idle');
    expect(result.current.topics).toEqual([]);
    expect(result.current.versions).toEqual([]);
    expect(result.current.comments).toEqual([]);
  });

  it('does not load without a crop', () => {
    setup({ cropId: null, topicId: null });

    expect(topicsMock).not.toHaveBeenCalled();
    expect(versionsMock).not.toHaveBeenCalled();
  });

  it('reloads when the crop changes', async () => {
    // Note the reload also clears the comments, which is not separately
    // observable: whenever a topic is selected the comments effect owns the
    // thread and refills it on the commit that follows, and with no topic
    // selected there is nothing to clear.

    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));

    rerender({ cropId: 2, topicId: null });

    await waitFor(() => expect(topicsMock).toHaveBeenLastCalledWith(2));
  });

  it('clears everything when the crop is closed', async () => {
    // The panel is reused for the next crop; leaving the previous one's
    // topics in place would show them under a different heading.
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.topics).toHaveLength(2));

    rerender({ cropId: null, topicId: null });

    expect(result.current.collaborationStatus).toBe('idle');
    expect(result.current.comments).toEqual([]);
    expect(result.current.versions).toEqual([]);
  });
});

describe('when the load fails', () => {
  it('reports the error and holds nothing', async () => {
    topicsMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await waitFor(() => expect(result.current.collaborationStatus).toBe('error'));
    expect(result.current.topics).toEqual([]);
    expect(result.current.versions).toEqual([]);
    expect(result.current.comments).toEqual([]);
  });

  it('fails as a whole when only the versions fail', async () => {
    // The two are awaited together, so a half-loaded panel is not a state
    // the hook can be in.
    versionsMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await waitFor(() => expect(result.current.collaborationStatus).toBe('error'));
    expect(result.current.topics).toEqual([]);
  });

  it('drops what it was showing when a later load fails', async () => {
    // A stale topic list under an error message would read as the crop still
    // having those topics, which is exactly what is not known.
    const { result } = setup();
    await waitFor(() => expect(result.current.topics).toHaveLength(2));
    topicsMock.mockRejectedValue(new Error('offline'));

    await act(async () => { await result.current.reload(1); });

    expect(result.current.collaborationStatus).toBe('error');
    expect(result.current.topics).toEqual([]);
    expect(result.current.versions).toEqual([]);
  });

  it('recovers on a later reload', async () => {
    topicsMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();
    await waitFor(() => expect(result.current.collaborationStatus).toBe('error'));
    topicsMock.mockResolvedValue({ data: TOPICS });

    await act(async () => { await result.current.reload(1); });

    expect(result.current.collaborationStatus).toBe('success');
    expect(result.current.topics).toEqual(TOPICS);
  });
});

describe('a load that has been overtaken', () => {
  it('ignores an older crop resolving last', async () => {
    // Clicking through the library faster than the network answers: the
    // first crop's topics must not land under the second crop's heading.
    const first = pending<{ data: PublicCropDiscussionTopic[] }>();
    topicsMock.mockReturnValue(first.promise);
    const { result } = setup();
    const second = [topic(20)];
    topicsMock.mockResolvedValue({ data: second });

    await act(async () => { await result.current.reload(2); });
    await act(async () => {
      first.resolve({ data: TOPICS });
      await first.promise;
    });

    expect(result.current.topics).toEqual(second);
  });

  it('ignores an older failure resolving last', async () => {
    // Same race, failing side: an abandoned request must not wipe the panel
    // the user is actually looking at.
    const first = pending<{ data: PublicCropDiscussionTopic[] }>();
    topicsMock.mockReturnValue(first.promise);
    const { result } = setup();
    topicsMock.mockResolvedValue({ data: TOPICS });

    await act(async () => { await result.current.reload(2); });
    await act(async () => {
      first.reject(new Error('offline'));
      await first.promise.catch(() => {});
    });

    expect(result.current.collaborationStatus).toBe('success');
    expect(result.current.topics).toEqual(TOPICS);
  });
});

describe('the selected topic', () => {
  it('loads its comments', async () => {
    const { result } = setup({ cropId: 1, topicId: 10 });

    await waitFor(() => expect(result.current.commentsStatus).toBe('success'));
    expect(result.current.comments).toEqual(COMMENTS);
    expect(commentsMock).toHaveBeenCalledWith(1, 10);
  });

  it('waits for the topic list before deciding anything', async () => {
    // Asking for comments before the topics arrive would look the topic up
    // in an empty list and report it as missing.
    const topicsRequest = pending<{ data: PublicCropDiscussionTopic[] }>();
    topicsMock.mockReturnValue(topicsRequest.promise);
    const { result, onSelectedTopicMissing } = setup({ cropId: 1, topicId: 10 });

    expect(commentsMock).not.toHaveBeenCalled();
    expect(onSelectedTopicMissing).not.toHaveBeenCalled();

    await act(async () => {
      topicsRequest.resolve({ data: TOPICS });
      await topicsRequest.promise;
    });
    await waitFor(() => expect(result.current.commentsStatus).toBe('success'));
  });

  it('tells the route when the topic is not in the list', async () => {
    // A deep link to a topic that has since been deleted, or one emptied by
    // a deletion; the route has to drop it from the URL.
    const { result, onSelectedTopicMissing } = setup({ cropId: 1, topicId: 404 });

    await waitFor(() => expect(onSelectedTopicMissing).toHaveBeenCalledTimes(1));
    expect(result.current.comments).toEqual([]);
    expect(result.current.commentsStatus).toBe('idle');
    expect(commentsMock).not.toHaveBeenCalled();
  });

  it('clears the comments when the topic is deselected', async () => {
    // Deselecting is not the same as the topic having gone missing: the route
    // must not be told to drop a topic it has already dropped.
    const { result, rerender, onSelectedTopicMissing } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.comments).toHaveLength(2));

    rerender({ cropId: 1, topicId: null });

    expect(result.current.comments).toEqual([]);
    expect(result.current.commentsStatus).toBe('idle');
    expect(onSelectedTopicMissing).not.toHaveBeenCalled();
  });

  it('drops the thread it was showing when a reload of it fails', async () => {
    // Leaving the old comments under an error would show a thread that may
    // no longer exist in that form.
    const { result, rerender } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.comments).toHaveLength(2));
    commentsMock.mockRejectedValue(new Error('offline'));

    rerender({ cropId: 1, topicId: 11 });

    await waitFor(() => expect(result.current.commentsStatus).toBe('error'));
    expect(result.current.comments).toEqual([]);
  });

  it('loads the other topic when the selection moves', async () => {
    const { result, rerender } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.commentsStatus).toBe('success'));

    rerender({ cropId: 1, topicId: 11 });

    await waitFor(() => expect(commentsMock).toHaveBeenLastCalledWith(1, 11));
  });

  it('reports an error without losing the topic list', async () => {
    // The thread failing to load does not mean the panel around it is gone.
    commentsMock.mockRejectedValue(new Error('offline'));
    const { result } = setup({ cropId: 1, topicId: 10 });

    await waitFor(() => expect(result.current.commentsStatus).toBe('error'));
    expect(result.current.comments).toEqual([]);
    expect(result.current.topics).toEqual(TOPICS);
    expect(result.current.collaborationStatus).toBe('success');
  });

  it('ignores comments that arrive after the topic changed', async () => {
    // Clicking from one thread to the next faster than the network answers.
    // The first request has to be genuinely in flight for this to test
    // anything, which means waiting until it has actually been issued -- the
    // comments effect only runs once the topic list has loaded, so swapping
    // the mock before that would leave no stale request at all.
    const first = pending<{ data: PublicCropDiscussionComment[] }>();
    commentsMock.mockReturnValue(first.promise);
    const { result, rerender } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(commentsMock).toHaveBeenCalledWith(1, 10));
    expect(result.current.commentsStatus).toBe('loading');

    const second = [comment(200, 11)];
    commentsMock.mockResolvedValue({ data: second });
    rerender({ cropId: 1, topicId: 11 });
    await waitFor(() => expect(result.current.comments).toEqual(second));

    await act(async () => {
      first.resolve({ data: COMMENTS });
      await first.promise;
    });

    expect(result.current.comments).toEqual(second);
  });
});

describe('live updates', () => {
  it('subscribes to the crop\'s discussion channel', async () => {
    const { result } = setup({ cropId: 7, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));

    expect(socketOptions.current?.path).toBe('ws/public-crops/7/discussions/');
  });

  it('does not subscribe for an anonymous reader', () => {
    // The socket needs an authenticated session; a signed-out visitor has
    // nothing to connect with.
    setup({ cropId: 7, topicId: null, liveUpdates: false });

    expect(socketOptions.current?.path).toBeNull();
  });

  it('does not subscribe without a crop', () => {
    setup({ cropId: null, topicId: null });

    expect(socketOptions.current?.path).toBeNull();
  });

  it('does not poll without a crop', async () => {
    // The poll callback is wired up regardless of whether a channel was
    // opened, so the refresh has to decline on its own rather than relying
    // on never being called.
    setup({ cropId: null, topicId: null });

    await act(async () => {
      socketOptions.current?.onFallbackPoll();
      await Promise.resolve();
    });

    expect(topicsMock).not.toHaveBeenCalled();
  });

  it('re-reads the topics when the discussion changes', async () => {
    const { result } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    const updated = [topic(10), topic(11), topic(12)];
    topicsMock.mockResolvedValue({ data: updated });

    await act(async () => {
      socketOptions.current?.onEvent({ type: 'discussion.updated', public_crop_id: 1 } as WebSocketEvent);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.topics).toEqual(updated));
  });

  it('re-reads the open thread as well', async () => {
    const { result } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.commentsStatus).toBe('success'));
    const updated = [comment(100), comment(101), comment(102)];
    commentsMock.mockResolvedValue({ data: updated });

    await act(async () => {
      socketOptions.current?.onEvent({ type: 'discussion.updated', public_crop_id: 1 } as WebSocketEvent);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.comments).toEqual(updated));
  });

  it('ignores an event for a different crop', async () => {
    // One socket can carry events for more than one crop while the panel
    // switches; acting on the wrong one would replace the visible thread.
    const { result } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    topicsMock.mockClear();

    await act(async () => {
      socketOptions.current?.onEvent({ type: 'discussion.updated', public_crop_id: 2 } as WebSocketEvent);
      await Promise.resolve();
    });

    expect(topicsMock).not.toHaveBeenCalled();
  });

  it('ignores an event of another kind', async () => {
    const { result } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    topicsMock.mockClear();

    await act(async () => {
      socketOptions.current?.onEvent({ type: 'crop.updated', public_crop_id: 1 } as unknown as WebSocketEvent);
      await Promise.resolve();
    });

    expect(topicsMock).not.toHaveBeenCalled();
  });

  it('re-reads on the fallback poll when the socket is down', async () => {
    const { result } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    topicsMock.mockClear();

    await act(async () => {
      socketOptions.current?.onFallbackPoll();
      await Promise.resolve();
    });

    expect(topicsMock).toHaveBeenCalledWith(1);
  });

  it('does not show a spinner while refreshing', async () => {
    // The refresh runs behind the user's back; flipping to loading would
    // blank a thread they are reading.
    const { result } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.commentsStatus).toBe('success'));

    act(() => { socketOptions.current?.onFallbackPoll(); });

    expect(result.current.collaborationStatus).toBe('success');
    expect(result.current.commentsStatus).toBe('success');
  });

  it('keeps the last usable state when a refresh fails', async () => {
    // The socket and the poll will try again; wiping the panel for one
    // failed background read would be worse than showing slightly old data.
    const { result } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.comments).toHaveLength(2));
    topicsMock.mockRejectedValue(new Error('offline'));

    await act(async () => {
      socketOptions.current?.onFallbackPoll();
      await Promise.resolve();
    });

    expect(result.current.topics).toEqual(TOPICS);
    expect(result.current.comments).toEqual(COMMENTS);
    expect(result.current.collaborationStatus).toBe('success');
  });
});

describe('after writing a comment', () => {
  it('re-reads the thread', async () => {
    const { result } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.commentsStatus).toBe('success'));
    const updated = [comment(100), comment(102)];
    commentsMock.mockResolvedValue({ data: updated });

    await act(async () => { await result.current.refreshComments(); });

    expect(result.current.comments).toEqual(updated);
  });

  it('does nothing without a selected topic', async () => {
    const { result } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    commentsMock.mockClear();

    await act(async () => { await result.current.refreshComments(); });

    expect(commentsMock).not.toHaveBeenCalled();
  });

  it('does not touch the topic list', async () => {
    // Writing a comment does not change which topics exist.
    const { result } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.commentsStatus).toBe('success'));
    topicsMock.mockClear();

    await act(async () => { await result.current.refreshComments(); });

    expect(topicsMock).not.toHaveBeenCalled();
  });
});

describe('after deleting a comment', () => {
  it('re-reads both and hands back the fresh topics', async () => {
    // A deletion can empty a topic, so the caller needs the new list to see
    // whether the one it is showing survived.
    const { result } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.commentsStatus).toBe('success'));
    const remaining = [topic(11)];
    topicsMock.mockResolvedValue({ data: remaining });
    commentsMock.mockResolvedValue({ data: [] });

    let returned: PublicCropDiscussionTopic[] = [];
    await act(async () => { returned = await result.current.refreshTopicsAndComments(); });

    expect(returned).toEqual(remaining);
    expect(result.current.topics).toEqual(remaining);
    expect(result.current.comments).toEqual([]);
  });

  it('hands back an empty list when there is no topic to refresh', async () => {
    const { result } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));

    let returned: PublicCropDiscussionTopic[] = TOPICS;
    await act(async () => { returned = await result.current.refreshTopicsAndComments(); });

    expect(returned).toEqual([]);
  });
});

describe('after creating a topic', () => {
  it('shows it and its first comment', async () => {
    // The route selects the new topic immediately afterwards, and the two
    // steps belong together: the comments effect owns the thread whenever a
    // topic is selected, so with the selection left alone it clears what
    // `applyCreatedTopic` just wrote. What the function buys is that the
    // selection lands on a list and a thread that are already there.
    const { result, rerender } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    const created = topic(12);
    topicsMock.mockResolvedValue({ data: TOPICS });
    commentsMock.mockResolvedValue({ data: [comment(300, 12)] });

    await act(async () => { await result.current.applyCreatedTopic(created); });
    rerender({ cropId: 1, topicId: 12 });

    expect(result.current.topics[0]).toEqual(created);
    await waitFor(() => expect(result.current.comments).toEqual([comment(300, 12)]));
  });

  it('does not add it twice when the reload already has it', async () => {
    // The write and the reload race; the topic can already be in the list
    // the server returns.
    const { result } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    const created = topic(12);
    topicsMock.mockResolvedValue({ data: [created, ...TOPICS] });

    await act(async () => { await result.current.applyCreatedTopic(created); });

    expect(result.current.topics.filter((entry) => entry.id === 12)).toHaveLength(1);
  });

  it('keeps the other topics the reload returned', async () => {
    // The new topic goes on top of the server's list rather than replacing
    // it, or creating a topic would empty the panel of everything else.
    const { result } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));

    await act(async () => { await result.current.applyCreatedTopic(topic(12)); });

    expect(result.current.topics.map((entry) => entry.id)).toEqual([12, 10, 11]);
  });

  it('leaves the panel loaded, and the topic list settled, on the switch', async () => {
    // The crop-level status stays 'success' across the route switch, so the
    // surrounding panel never blanks.
    //
    // The thread does still pass through 'loading': selecting the topic
    // changes `topicId`, which re-runs the comments effect, and that effect
    // always announces its own load. The source comment above the request-id
    // bump reads as though claiming the id prevents that spinner -- it does
    // not. What it actually prevents is an in-flight crop reload from landing
    // on top of the created topic, which the test below covers. Recorded
    // rather than changed; the comment is the thing that is wrong, not the
    // behaviour.
    const { result, rerender } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    commentsMock.mockResolvedValue({ data: [comment(300, 12)] });

    await act(async () => { await result.current.applyCreatedTopic(topic(12)); });
    rerender({ cropId: 1, topicId: 12 });

    expect(result.current.collaborationStatus).toBe('success');
    expect(result.current.commentsStatus).toBe('loading');
    await waitFor(() => expect(result.current.commentsStatus).toBe('success'));
  });

  it('claims the request id so the route switch does not reload', async () => {
    // Selecting the new topic re-runs the comments effect a moment later.
    // Without claiming the id, an in-flight load from before could still
    // land and flash the panel back to loading.
    const inFlight = pending<{ data: PublicCropDiscussionTopic[] }>();
    const { result, rerender } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));

    topicsMock.mockReturnValue(inFlight.promise);
    act(() => { void result.current.reload(1); });
    topicsMock.mockResolvedValue({ data: TOPICS });

    await act(async () => { await result.current.applyCreatedTopic(topic(12)); });
    rerender({ cropId: 1, topicId: 12 });
    await act(async () => {
      inFlight.resolve({ data: [] });
      await inFlight.promise;
    });

    expect(result.current.topics[0]).toEqual(topic(12));
    expect(result.current.collaborationStatus).toBe('success');
  });

  it('does nothing without a crop', async () => {
    const { result } = setup({ cropId: null, topicId: null });

    await act(async () => { await result.current.applyCreatedTopic(topic(12)); });

    expect(topicsMock).not.toHaveBeenCalled();
  });

  it('has its thread cleared again if the route does not select it', async () => {
    // Recorded rather than endorsed: with no topic selected, the comments
    // effect owns the thread and empties it on the next commit. The function
    // is only meaningful as one half of a pair with the route switch.
    //
    // This is also why the comment write inside `applyCreatedTopic` cannot be
    // observed on its own -- the effect either clears it, as here, or
    // refetches over it when the route does select the topic. The topic-list
    // write is the part that does the work.
    const { result } = setup({ cropId: 1, topicId: null });
    await waitFor(() => expect(result.current.collaborationStatus).toBe('success'));
    commentsMock.mockResolvedValue({ data: [comment(300, 12)] });

    await act(async () => { await result.current.applyCreatedTopic(topic(12)); });

    expect(result.current.comments).toEqual([]);
    expect(result.current.commentsStatus).toBe('idle');
    expect(result.current.topics[0]).toEqual(topic(12));
  });
});

describe('clearComments', () => {
  it('empties the thread without touching the topics', async () => {
    const { result } = setup({ cropId: 1, topicId: 10 });
    await waitFor(() => expect(result.current.comments).toHaveLength(2));

    act(() => { result.current.clearComments(); });

    expect(result.current.comments).toEqual([]);
    expect(result.current.commentsStatus).toBe('idle');
    expect(result.current.topics).toEqual(TOPICS);
  });
});
