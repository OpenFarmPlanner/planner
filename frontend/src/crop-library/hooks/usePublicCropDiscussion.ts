import { useCallback, useEffect, useRef, useState } from 'react';
import { publicCropAPI } from '../../api/api';
import type {
  PublicCropDiscussionComment,
  PublicCropDiscussionTopic,
  PublicCropRevision,
} from '../../api/types';
import { useWebSocket, type WebSocketEvent } from '../../realtime/useWebSocket';
import { withCreatedTopic } from '../publicCropListMerge';

export type PublicCropCollaborationStatus = 'idle' | 'loading' | 'success' | 'error';

interface UsePublicCropDiscussionOptions {
  cropId: number | null;
  topicId: number | null;
  /** Live updates need an authenticated socket; anonymous readers poll nothing. */
  liveUpdates: boolean;
  /** The selected topic vanished from the reloaded list, so the route has to drop it. */
  onSelectedTopicMissing: () => void;
}

export interface PublicCropDiscussion {
  topics: PublicCropDiscussionTopic[];
  comments: PublicCropDiscussionComment[];
  versions: PublicCropRevision[];
  collaborationStatus: PublicCropCollaborationStatus;
  commentsStatus: PublicCropCollaborationStatus;
  /** Reload topics and versions for a crop, discarding any in-flight load. */
  reload: (cropId: number) => Promise<void>;
  /** Re-read the comments of the selected topic after writing one. */
  refreshComments: () => Promise<void>;
  /**
   * Re-read topics and comments after a comment deletion may have emptied a
   * topic, and hand back the fresh topics so the caller can tell whether the
   * selected one survived.
   */
  refreshTopicsAndComments: () => Promise<PublicCropDiscussionTopic[]>;
  /** Show a freshly created topic and its first comment without a loading flash. */
  applyCreatedTopic: (createdTopic: PublicCropDiscussionTopic) => Promise<void>;
  clearComments: () => void;
}

/**
 * Owns the discussion and version state of one public crop: the REST loads, the
 * socket refresh, and the writes that follow a comment or topic mutation.
 */
export function usePublicCropDiscussion({
  cropId,
  topicId,
  liveUpdates,
  onSelectedTopicMissing,
}: UsePublicCropDiscussionOptions): PublicCropDiscussion {
  const [topics, setTopics] = useState<PublicCropDiscussionTopic[]>([]);
  const [comments, setComments] = useState<PublicCropDiscussionComment[]>([]);
  const [versions, setVersions] = useState<PublicCropRevision[]>([]);
  const [collaborationStatus, setCollaborationStatus] = useState<PublicCropCollaborationStatus>('idle');
  const [commentsStatus, setCommentsStatus] = useState<PublicCropCollaborationStatus>('idle');
  const loadRequestIdRef = useRef(0);

  const reload = useCallback(async (targetCropId: number): Promise<void> => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setCollaborationStatus('loading');
    try {
      const [topicsResponse, versionsResponse] = await Promise.all([
        publicCropAPI.discussionTopics(targetCropId),
        publicCropAPI.versions(targetCropId),
      ]);
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      setTopics(topicsResponse.data);
      setComments([]);
      setVersions(versionsResponse.data);
      setCollaborationStatus('success');
    } catch {
      if (requestId !== loadRequestIdRef.current) {
        return;
      }
      setComments([]);
      setTopics([]);
      setVersions([]);
      setCollaborationStatus('error');
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (cropId === null) return;
    try {
      const topicsResponse = await publicCropAPI.discussionTopics(cropId);
      setTopics(topicsResponse.data);
      if (topicId !== null) {
        const commentsResponse = await publicCropAPI.discussionComments(cropId, topicId);
        setComments(commentsResponse.data);
        setCommentsStatus('success');
      }
    } catch {
      // Keep the last usable REST state; the socket and fallback poll retry.
    }
  }, [cropId, topicId]);

  const handleDiscussionEvent = useCallback((event: WebSocketEvent): void => {
    if (event.type === 'discussion.updated' && event.public_crop_id === cropId) {
      void refresh();
    }
  }, [cropId, refresh]);

  useWebSocket({
    path: liveUpdates && cropId !== null ? `ws/public-crops/${cropId}/discussions/` : null,
    onEvent: handleDiscussionEvent,
    onFallbackPoll: () => { void refresh(); },
  });

  useEffect(() => {
    if (cropId === null) {
      setComments([]);
      setVersions([]);
      setCollaborationStatus('idle');
      setCommentsStatus('idle');
      return;
    }
    void reload(cropId);
  }, [cropId, reload]);

  useEffect(() => {
    if (cropId === null || topicId === null) {
      setComments([]);
      setCommentsStatus('idle');
      return;
    }
    if (collaborationStatus !== 'success') {
      return;
    }
    if (!topics.some((topic) => topic.id === topicId)) {
      onSelectedTopicMissing();
      setComments([]);
      setCommentsStatus('idle');
      return;
    }

    let cancelled = false;
    setCommentsStatus('loading');
    publicCropAPI.discussionComments(cropId, topicId)
      .then((response) => {
        if (!cancelled) {
          setComments(response.data);
          setCommentsStatus('success');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setComments([]);
          setCommentsStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [collaborationStatus, cropId, onSelectedTopicMissing, topicId, topics]);

  const refreshComments = useCallback(async (): Promise<void> => {
    if (cropId === null || topicId === null) return;
    const response = await publicCropAPI.discussionComments(cropId, topicId);
    setComments(response.data);
  }, [cropId, topicId]);

  const refreshTopicsAndComments = useCallback(async (): Promise<PublicCropDiscussionTopic[]> => {
    if (cropId === null || topicId === null) return [];
    const [topicsResponse, commentsResponse] = await Promise.all([
      publicCropAPI.discussionTopics(cropId),
      publicCropAPI.discussionComments(cropId, topicId),
    ]);
    setTopics(topicsResponse.data);
    setComments(commentsResponse.data);
    return topicsResponse.data;
  }, [cropId, topicId]);

  const applyCreatedTopic = useCallback(async (
    createdTopic: PublicCropDiscussionTopic,
  ): Promise<void> => {
    if (cropId === null) return;
    // The route switches to the new topic right after this, which would re-run the
    // comments effect; claiming the request id keeps that from flashing a spinner.
    loadRequestIdRef.current += 1;
    const [topicsResponse, commentsResponse] = await Promise.all([
      publicCropAPI.discussionTopics(cropId),
      publicCropAPI.discussionComments(cropId, createdTopic.id),
    ]);
    setTopics(withCreatedTopic(topicsResponse.data, createdTopic));
    setComments(commentsResponse.data);
    setCommentsStatus('success');
    setCollaborationStatus('success');
  }, [cropId]);

  const clearComments = useCallback((): void => {
    setComments([]);
    setCommentsStatus('idle');
  }, []);

  return {
    topics,
    comments,
    versions,
    collaborationStatus,
    commentsStatus,
    reload,
    refreshComments,
    refreshTopicsAndComments,
    applyCreatedTopic,
    clearComments,
  };
}
