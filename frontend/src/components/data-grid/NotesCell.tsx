/**
 * NotesCell component for rendering notes field in DataGrid.
 */

import { useEffect, useRef, type MouseEvent } from 'react';
import { Badge, Box, IconButton, Typography } from '@mui/material';
import NotesIcon from '@mui/icons-material/Notes';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from '../../i18n';
import type { NotesPreviewOpenMode } from './useNotesPreview';
import { AppTooltip } from '../AppTooltip';

export interface NotesCellProps {
  hasValue: boolean;
  excerpt: string;
  rawValue: string;
  onOpen: () => void;
  attachmentCount?: number;
  compactIndicator?: boolean;
  onOpenAttachments?: (event: MouseEvent<HTMLButtonElement>) => void;
  hasFocus?: boolean;
  /** Whether the shared notes preview popover is currently open for this cell. */
  isPreviewOpen?: boolean;
  /** Request that the shared preview popover open, anchored to the given element. */
  onPreviewOpen?: (anchorEl: HTMLElement, mode: NotesPreviewOpenMode) => void;
  /** Request that the shared preview popover close (may be debounced by the caller). */
  onPreviewClose?: () => void;
}

export function NotesCell({
  hasValue,
  excerpt,
  rawValue,
  onOpen,
  attachmentCount = 0,
  compactIndicator = false,
  onOpenAttachments,
  hasFocus = false,
  isPreviewOpen = false,
  onPreviewOpen,
  onPreviewClose,
}: NotesCellProps) {
  const { t } = useTranslation('common');
  const compactTriggerRef = useRef<HTMLDivElement | null>(null);
  const notesButtonRef = useRef<HTMLButtonElement | null>(null);
  const suppressNextClickRef = useRef(false);

  const firstLine = excerpt.split('\n')[0];
  const displayText = firstLine.length > 40 ? `${firstLine.substring(0, 37)}...` : firstLine;
  const hasMore = excerpt.length > firstLine.length || firstLine.length > 40;

  const tooltipMarkdown = rawValue.length > 2000 ? rawValue.substring(0, 2000) + '\n\n...' : rawValue;

  const tooltipContent = hasValue ? (
    <Box
      sx={{
        maxWidth: 480,
        maxHeight: 280,
        overflowY: 'auto',
        p: 1.5,
        pointerEvents: 'none',
        '& p': { margin: '0.5em 0' },
        '& h1, & h2, & h3, & h4, & h5, & h6': { margin: '0.5em 0', fontSize: '1.1em' },
        '& ul, & ol': { margin: '0.5em 0', paddingLeft: 2 },
        '& code': {
          backgroundColor: 'action.hover',
          padding: '0.1em 0.3em',
          borderRadius: 0.5,
          fontSize: '0.85em',
        },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ html: () => null }}
      >
        {tooltipMarkdown}
      </ReactMarkdown>
    </Box>
  ) : (
    <Typography variant="body2">{t('notes.empty')}</Typography>
  );

  const notesAria = hasValue ? t('notes.editWithContent') : t('notes.editEmpty');
  const attachmentTooltip = t('notes.attachmentsCount', { count: attachmentCount });
  const hasAttachments = attachmentCount > 0;
  useEffect(() => {
    if (!hasFocus) {
      return;
    }

    requestAnimationFrame(() => {
      (compactIndicator ? compactTriggerRef.current : notesButtonRef.current)?.focus();
    });
  }, [compactIndicator, hasFocus]);

  const compactAriaLabel = hasValue && hasAttachments
    ? t('notes.compactNoteAndImages')
    : hasValue
      ? t('notes.compactNote')
      : hasAttachments
        ? t('notes.compactImages')
        : t('notes.compactEmpty');

  if (compactIndicator) {
    const hasPreview = Boolean(onPreviewOpen);
    return (
      <Box
        ref={compactTriggerRef}
        role="button"
        tabIndex={hasFocus ? 0 : -1}
        aria-label={compactAriaLabel}
        aria-haspopup={hasPreview ? 'dialog' : undefined}
        aria-expanded={hasPreview ? isPreviewOpen : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onOpen();
          }
        }}
        onMouseEnter={(event) => onPreviewOpen?.(event.currentTarget, 'hover')}
        onMouseLeave={() => onPreviewClose?.()}
        onFocus={(event) => onPreviewOpen?.(event.currentTarget, 'immediate')}
        onBlur={() => onPreviewClose?.()}
        onTouchStart={(event) => {
          if (onPreviewOpen && !isPreviewOpen) {
            suppressNextClickRef.current = true;
            onPreviewOpen(event.currentTarget, 'immediate');
          }
        }}
        sx={{
          width: '100%',
          height: '100%',
          minHeight: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.25,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          outline: 'none',
          '&:focus, &:focus-visible': {
            outline: 'none',
          },
        }}
      >
        {hasValue ? <NotesIcon fontSize="small" color="action" /> : null}
        {hasAttachments ? <PhotoLibraryIcon fontSize="small" color="action" /> : null}
        {!hasValue && !hasAttachments ? (
          <Typography variant="body2" color="text.disabled" aria-hidden>
            —
          </Typography>
        ) : null}
      </Box>
    );
  }

  return (
    <AppTooltip
      title={tooltipContent}
      placement="top-start"
      arrow
      enterDelay={500}
      disableHoverListener={!hasValue}
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: 'common.white',
            color: 'text.primary',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: 3,
          },
        },
      }}
    >
      <Box
        role="button"
        tabIndex={-1}
        aria-label={notesAria}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onOpen();
          }
        }}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          py: 0.25,
          position: 'relative',
          minHeight: 32,
          cursor: 'pointer',
        }}
      >
        <IconButton
          ref={notesButtonRef}
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          aria-label={notesAria}
          tabIndex={hasFocus ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onOpen();
            }
          }}
          sx={{ p: 0.5 }}
        >
          {hasValue ? (
            <NotesIcon fontSize="small" color="primary" />
          ) : (
            <NotesOutlinedIcon fontSize="small" color="disabled" />
          )}
        </IconButton>

        <Typography
          variant="body2"
          sx={{
            color: hasValue ? 'text.primary' : 'text.disabled',
            fontStyle: hasValue ? 'normal' : 'italic',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexGrow: 1,
            pr: attachmentCount > 0 ? 3.5 : 0,
          }}
        >
          {hasValue ? displayText : t('notes.empty')}
          {hasValue && hasMore ? ' ...' : ''}
        </Typography>

        {hasAttachments && onOpenAttachments && (
          <AppTooltip title={attachmentTooltip} arrow>
            <IconButton
              size="small"
              onClick={(event) => { event.stopPropagation(); event.preventDefault(); onOpenAttachments(event); }}
              aria-label={attachmentTooltip}
              tabIndex={-1}
              sx={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 24,
                height: 24,
                p: 0,
                bgcolor: 'background.paper',
                '.MuiDataGrid-row:hover &': {
                  bgcolor: 'surface.surfaceHoverBackground',
                },
              }}
            >
              <Badge
                color="primary"
                badgeContent={attachmentCount > 1 ? attachmentCount : undefined}
                overlap="circular"
              >
                <PhotoLibraryIcon fontSize="small" color="action" />
              </Badge>
            </IconButton>
          </AppTooltip>
        )}
      </Box>
    </AppTooltip>
  );
}
