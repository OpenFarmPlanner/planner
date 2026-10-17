import { useId, type FormEvent, type ReactNode, type Ref } from 'react';
import { Box, Chip, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material';
import MoreVertOutlinedIcon from '@mui/icons-material/MoreVertOutlined';
import ReplyOutlinedIcon from '@mui/icons-material/ReplyOutlined';
import type { PublicCropDiscussionComment } from '../../../api/types';
import { AppTooltip } from '../../../components/AppTooltip';
import { CommentForm } from './CommentForm';
import { MAX_VISIBLE_REPLY_DEPTH, getDeletedCommentPlaceholder, getPublicAuthorLabel, type ThreadCommentGroup } from './formatters';

export interface DiscussionCommentProps {
  comment: PublicCropDiscussionComment;
  anonymousLabel: string;
  formatDate: (value?: string | null) => string;
  isReply: boolean;
  logicalDepth: number;
  visualDepth: number;
  parentAuthorLabel?: string;
  /** The topic's first post never carries the topic-starter badge. */
  isOpeningPost?: boolean;
  isEditing: boolean;
  menuAnchorElement: HTMLElement | null;
  submittingComment: boolean;
  /** Blocks writing while reading stays available (e.g. species awaiting moderation). */
  writingDisabled?: boolean;
  commentBody: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  onReply: (commentId: number) => void;
  onEdit: (comment: PublicCropDiscussionComment) => void;
  onDelete: (commentId: number) => void;
  onDeleteBlocked: () => void;
  onOpenMenu: (commentId: number, element: HTMLElement) => void;
  onCloseMenu: () => void;
  onCancelEdit: () => void;
  onCommentSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCommentBodyChange: (body: string) => void;
  registerReplyActionRef: (commentId: number, element: HTMLButtonElement | null) => void;
  registerCommentRef: (commentId: number, element: HTMLDivElement | null) => void;
  activeFormInputRef: Ref<HTMLInputElement>;
}

export function DiscussionComment({
  comment,
  anonymousLabel,
  formatDate,
  isReply,
  logicalDepth,
  visualDepth,
  parentAuthorLabel,
  isOpeningPost = false,
  isEditing,
  menuAnchorElement,
  submittingComment,
  writingDisabled = false,
  commentBody,
  t,
  onReply,
  onEdit,
  onDelete,
  onDeleteBlocked,
  onOpenMenu,
  onCloseMenu,
  onCancelEdit,
  onCommentSubmit,
  onCommentBodyChange,
  registerReplyActionRef,
  registerCommentRef,
  activeFormInputRef,
}: DiscussionCommentProps) {
  const authorLabel = getPublicAuthorLabel(comment, anonymousLabel, t);
  const metaText = `${t('library.page.metaByDate', {
    author: authorLabel,
    date: formatDate(comment.created_at),
  })}${comment.is_edited ? ` · ${t('library.page.discussion.edited')}` : ''}`;
  const metaId = useId();
  const authorBadge = getAuthorBadgeLabel(comment, isOpeningPost, t);
  const replyLabel = t('library.page.discussion.replyToAuthor', { author: authorLabel });
  const deletedPlaceholder = getDeletedCommentPlaceholder(comment, t);
  const canShowDeleteAction = comment.can_delete || comment.delete_blocked_reason === 'visible_replies';

  return (
    <Box
      ref={(element: HTMLDivElement | null) => registerCommentRef(comment.id, element)}
      tabIndex={-1}
      role="article"
      aria-labelledby={metaId}
      data-comment-id={comment.id}
      data-logical-depth={logicalDepth}
      data-visual-depth={visualDepth}
      sx={{
        display: 'grid',
        gap: 0.5,
        outline: 0,
        py: isReply ? 1 : 0,
        '&:focus-visible': {
          borderRadius: 1,
          boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
        },
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1, alignItems: 'start' }}>
        <Box sx={{ minWidth: 0 }}>
          {isReply && parentAuthorLabel && logicalDepth > MAX_VISIBLE_REPLY_DEPTH ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
              {t('library.page.discussion.replyContext', { author: parentAuthorLabel })}
            </Typography>
          ) : null}
          <Box id={metaId} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 0.75 }}>
            <Typography variant="caption" color="text.secondary">
              {metaText}
            </Typography>
            {authorBadge ? <Chip size="small" variant="outlined" label={authorBadge} /> : null}
          </Box>
          {isEditing ? (
            <Box sx={{ mt: 1 }}>
              <CommentForm
                body={commentBody}
                disabled={submittingComment || writingDisabled}
                inputRef={activeFormInputRef}
                label={t('library.page.discussion.commentLabel')}
                submitLabel={t('library.page.discussion.submit')}
                t={t}
                onBodyChange={onCommentBodyChange}
                onCancel={onCancelEdit}
                onSubmit={onCommentSubmit}
              />
            </Box>
          ) : (
            <Typography
              variant="body2"
              color={comment.deleted_at ? 'text.secondary' : 'text.primary'}
              aria-label={comment.deleted_at ? deletedPlaceholder : undefined}
              sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 0.5, fontStyle: comment.deleted_at ? 'italic' : 'normal' }}
            >
              {comment.deleted_at ? deletedPlaceholder : comment.body}
            </Typography>
          )}
        </Box>
        {!comment.deleted_at && !isEditing ? (
          <Stack direction="row" spacing={0.25} sx={{ mt: -0.5 }}>
            <AppTooltip title={replyLabel}>
              <IconButton
                ref={(element: HTMLButtonElement | null) => registerReplyActionRef(comment.id, element)}
                size="small"
                aria-label={replyLabel}
                onClick={() => onReply(comment.id)}
                disabled={writingDisabled}
              >
                <ReplyOutlinedIcon fontSize="small" />
              </IconButton>
            </AppTooltip>
            {comment.can_edit || canShowDeleteAction ? (
              <>
                <AppTooltip title={t('library.page.discussion.moreActions')}>
                  <IconButton
                    size="small"
                    aria-label={t('library.page.discussion.moreActions')}
                    aria-haspopup="menu"
                    aria-expanded={Boolean(menuAnchorElement)}
                    onClick={(event) => onOpenMenu(comment.id, event.currentTarget)}
                  >
                    <MoreVertOutlinedIcon fontSize="small" />
                  </IconButton>
                </AppTooltip>
                <Menu
                  anchorEl={menuAnchorElement}
                  open={Boolean(menuAnchorElement)}
                  onClose={onCloseMenu}
                >
                  {comment.can_edit ? (
                    <MenuItem onClick={() => { onCloseMenu(); onEdit(comment); }}>{t('library.page.discussion.edit')}</MenuItem>
                  ) : null}
                  {canShowDeleteAction ? (
                    <MenuItem
                      onClick={() => {
                        onCloseMenu();
                        if (comment.delete_blocked_reason === 'visible_replies') {
                          onDeleteBlocked();
                          return;
                        }
                        onDelete(comment.id);
                      }}
                      sx={{ color: comment.can_delete ? 'error.main' : 'text.primary' }}
                    >
                      {t('library.page.discussion.delete')}
                    </MenuItem>
                  ) : null}
                </Menu>
              </>
            ) : null}
          </Stack>
        ) : null}
      </Box>
    </Box>
  );
}

function getAuthorBadgeLabel(
  comment: PublicCropDiscussionComment,
  isOpeningPost: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (comment.is_own) {
    return t('library.page.discussion.ownBadge');
  }
  if (comment.is_topic_starter && !isOpeningPost) {
    return t('library.page.discussion.topicStarterBadge');
  }
  return null;
}

export interface ThreadCommentBranchProps {
  node: ThreadCommentGroup;
  depth: number;
  parentAuthorLabel?: string;
  openingCommentId?: number;
  /** Shown above reply forms, e.g. the anonymous-posting notice. */
  composeNotice?: ReactNode;
  anonymousLabel: string;
  formatDate: (value?: string | null) => string;
  replyTo: number | null;
  editingCommentId: number | null;
  commentActionMenu: { commentId: number; anchorElement: HTMLElement } | null;
  submittingComment: boolean;
  /** Blocks writing while reading stays available (e.g. species awaiting moderation). */
  writingDisabled?: boolean;
  commentBody: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  onReply: (commentId: number) => void;
  onEdit: (comment: PublicCropDiscussionComment) => void;
  onDelete: (commentId: number) => void;
  onDeleteBlocked: () => void;
  onOpenMenu: (commentId: number, element: HTMLElement) => void;
  onCloseMenu: () => void;
  onCancelEdit: () => void;
  onCommentSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCommentBodyChange: (body: string) => void;
  registerReplyActionRef: (commentId: number, element: HTMLButtonElement | null) => void;
  registerCommentRef: (commentId: number, element: HTMLDivElement | null) => void;
  activeFormInputRef: Ref<HTMLInputElement>;
}

export function ThreadCommentBranch({
  node,
  depth,
  parentAuthorLabel,
  openingCommentId,
  composeNotice,
  anonymousLabel,
  formatDate,
  replyTo,
  editingCommentId,
  commentActionMenu,
  submittingComment,
  writingDisabled = false,
  commentBody,
  t,
  onReply,
  onEdit,
  onDelete,
  onDeleteBlocked,
  onOpenMenu,
  onCloseMenu,
  onCancelEdit,
  onCommentSubmit,
  onCommentBodyChange,
  registerReplyActionRef,
  registerCommentRef,
  activeFormInputRef,
}: ThreadCommentBranchProps) {
  const visualDepth = Math.min(depth, MAX_VISIBLE_REPLY_DEPTH);
  const childDepth = depth + 1;
  const childVisualDepth = Math.min(childDepth, MAX_VISIBLE_REPLY_DEPTH);
  const childIndentIncreases = childVisualDepth > visualDepth;
  const childAuthorLabel = getPublicAuthorLabel(node.comment, anonymousLabel, t);
  const hasChildGroup = node.children.length > 0 || replyTo === node.comment.id;

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <DiscussionComment
        comment={node.comment}
        anonymousLabel={anonymousLabel}
        formatDate={formatDate}
        isReply={depth > 0}
        logicalDepth={depth}
        visualDepth={visualDepth}
        parentAuthorLabel={parentAuthorLabel}
        isOpeningPost={node.comment.id === openingCommentId}
        isEditing={editingCommentId === node.comment.id}
        menuAnchorElement={commentActionMenu?.commentId === node.comment.id ? commentActionMenu.anchorElement : null}
        submittingComment={submittingComment}
        writingDisabled={writingDisabled}
        commentBody={commentBody}
        t={t}
        onReply={onReply}
        onEdit={onEdit}
        onDelete={onDelete}
        onDeleteBlocked={onDeleteBlocked}
        onOpenMenu={onOpenMenu}
        onCloseMenu={onCloseMenu}
        onCancelEdit={onCancelEdit}
        onCommentSubmit={onCommentSubmit}
        onCommentBodyChange={onCommentBodyChange}
        registerReplyActionRef={registerReplyActionRef}
        registerCommentRef={registerCommentRef}
        activeFormInputRef={activeFormInputRef}
      />
      {hasChildGroup ? (
        <Box
          role="group"
          aria-label={t('library.page.discussion.repliesForAuthor', { author: childAuthorLabel })}
          sx={{
            borderLeft: childIndentIncreases ? 2 : 0,
            borderColor: 'divider',
            display: 'grid',
            gap: 1,
            ml: childIndentIncreases ? { xs: 1, sm: 2 } : 0,
            pl: childIndentIncreases ? { xs: 1.25, sm: 1.75 } : 0,
          }}
        >
          {node.children.map((childNode) => (
            <ThreadCommentBranch
              key={childNode.comment.id}
              node={childNode}
              depth={childDepth}
              parentAuthorLabel={childAuthorLabel}
              openingCommentId={openingCommentId}
              composeNotice={composeNotice}
              anonymousLabel={anonymousLabel}
              formatDate={formatDate}
              replyTo={replyTo}
              editingCommentId={editingCommentId}
              commentActionMenu={commentActionMenu}
              submittingComment={submittingComment}
              writingDisabled={writingDisabled}
              commentBody={commentBody}
              t={t}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onDeleteBlocked={onDeleteBlocked}
              onOpenMenu={onOpenMenu}
              onCloseMenu={onCloseMenu}
              onCancelEdit={onCancelEdit}
              onCommentSubmit={onCommentSubmit}
              onCommentBodyChange={onCommentBodyChange}
              registerReplyActionRef={registerReplyActionRef}
              registerCommentRef={registerCommentRef}
              activeFormInputRef={activeFormInputRef}
            />
          ))}
          {replyTo === node.comment.id ? composeNotice : null}
          {replyTo === node.comment.id ? (
            <CommentForm
              body={commentBody}
              disabled={submittingComment || writingDisabled}
              inputRef={activeFormInputRef}
              label={t('library.page.discussion.replyLabel')}
              submitLabel={t('library.page.discussion.submit')}
              t={t}
              onBodyChange={onCommentBodyChange}
              onCancel={onCancelEdit}
              onSubmit={onCommentSubmit}
            />
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
