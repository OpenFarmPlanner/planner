/**
 * Compact, interactive preview of a note's text and attached photos.
 *
 * Opens on hover/focus/touch of the notes cell trigger (see NotesCell) and
 * stays open while the pointer is inside it, so users can glance at a note
 * without opening the full NotesDrawer editor. It never enters edit mode
 * itself — the only way to edit is via the explicit "Notiz öffnen" action or
 * by clicking the trigger directly.
 */

import { useEffect, useState } from 'react';
import { Box, ButtonBase, Popover, Stack, Typography } from '@mui/material';
import { getCachedNoteAttachments } from './noteAttachmentsCache';
import { stripMarkdown } from './markdown';
import type { NoteAttachment } from '../../api/types';
import { useTranslation } from '../../i18n';
import { alpha } from '@mui/material/styles';

const MAX_VISIBLE_THUMBNAILS = 3;
const THUMBNAIL_SIZE = 56;

export interface NotesPreviewPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  rawValue: string;
  hasValue: boolean;
  noteId?: number;
  attachmentCount: number;
  onClose: () => void;
  onOpenNote: () => void;
  onOpenAttachment: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * Fetches and renders the thumbnail row for one note. Keyed by `noteId` at
 * the call site so switching to a different note remounts (and resets) this
 * component instead of needing an effect-driven state reset.
 */
function NotesPreviewThumbnails({
  noteId,
  onOpenAttachment,
}: {
  noteId: number;
  onOpenAttachment: () => void;
}) {
  const { t } = useTranslation('common');
  const [attachments, setAttachments] = useState<NoteAttachment[] | null>(null);
  const [loadError, setLoadError] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    getCachedNoteAttachments(noteId)
      .then((result) => {
        if (!cancelled) setAttachments(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const visibleAttachments = attachments?.slice(0, MAX_VISIBLE_THUMBNAILS) ?? [];
  const overlayCount = attachments && attachments.length > MAX_VISIBLE_THUMBNAILS
    ? attachments.length - (MAX_VISIBLE_THUMBNAILS - 1)
    : 0;
  const thumbnailsToRender = overlayCount > 0
    ? visibleAttachments.slice(0, MAX_VISIBLE_THUMBNAILS - 1)
    : visibleAttachments;

  return (
    <Stack direction="row" spacing={1}>
      {attachments === null && !loadError ? (
        <Typography variant="caption" color="text.secondary">
          {t('notesPreview.loadingImages')}
        </Typography>
      ) : null}
      {loadError ? (
        <Typography variant="caption" color="text.secondary">
          {t('notesPreview.imagesLoadError')}
        </Typography>
      ) : null}
      {thumbnailsToRender.map((attachment) => (
        <ButtonBase
          key={attachment.id}
          onClick={onOpenAttachment}
          aria-label={t('notesPreview.openImageAria')}
          sx={{
            width: THUMBNAIL_SIZE,
            height: THUMBNAIL_SIZE,
            borderRadius: 1,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <Box
            component="img"
            src={attachment.image_url ?? attachment.image}
            alt={attachment.caption || t('notesDrawer.attachmentAlt')}
            loading="lazy"
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </ButtonBase>
      ))}
      {overlayCount > 0 && attachments ? (
        <ButtonBase
          onClick={onOpenAttachment}
          aria-label={t('notesPreview.moreImagesAria', { count: overlayCount })}
          sx={{
            position: 'relative',
            width: THUMBNAIL_SIZE,
            height: THUMBNAIL_SIZE,
            borderRadius: 1,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <Box
            component="img"
            src={attachments[MAX_VISIBLE_THUMBNAILS - 1]?.image_url ?? attachments[MAX_VISIBLE_THUMBNAILS - 1]?.image}
            alt=""
            loading="lazy"
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              bgcolor: (theme) => alpha(theme.palette.common.black, 0.55),
              color: 'common.white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            +{overlayCount}
          </Box>
        </ButtonBase>
      ) : null}
    </Stack>
  );
}

export function NotesPreviewPopover({
  open,
  anchorEl,
  rawValue,
  hasValue,
  noteId,
  attachmentCount,
  onClose,
  onOpenNote,
  onOpenAttachment,
  onMouseEnter,
  onMouseLeave,
}: NotesPreviewPopoverProps) {
  const { t } = useTranslation('common');
  const preview = hasValue ? stripMarkdown(rawValue) : '';
  const showThumbnails = open && attachmentCount > 0 && Boolean(noteId);

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      disableAutoFocus
      disableEnforceFocus
      disableRestoreFocus
      hideBackdrop
      disableScrollLock
      sx={{ pointerEvents: 'none' }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': t('notesPreview.heading'),
          onMouseEnter,
          onMouseLeave,
          sx: {
            width: 360,
            maxWidth: 'min(360px, 90vw)',
            p: 2,
            borderRadius: 2,
            boxShadow: 4,
            pointerEvents: 'auto',
          },
        },
      }}
    >
      <Stack spacing={1.25}>
        <Typography variant="subtitle2" component="h2">
          {t('notesPreview.heading')}
        </Typography>

        {hasValue ? (
          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-line',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {preview}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", }} >
            {t('notesPreview.empty')}
          </Typography>
        )}

        {showThumbnails ? (
          <NotesPreviewThumbnails key={noteId} noteId={noteId as number} onOpenAttachment={onOpenAttachment} />
        ) : null}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 0.5 }}>
          <ButtonBase
            onClick={onOpenNote}
            sx={{
              typography: 'button',
              color: 'primary.main',
              fontSize: 13,
              fontWeight: 600,
              px: 1,
              py: 0.5,
              borderRadius: 1,
            }}
          >
            {t('notesPreview.openNote')}
          </ButtonBase>
        </Box>
      </Stack>
    </Popover>
  );
}
