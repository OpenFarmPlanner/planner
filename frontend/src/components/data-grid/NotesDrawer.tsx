import { useState, useEffect, useRef, useCallback } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  Drawer,
  Box,
  Typography,
  Button,
  Tabs,
  Tab,
  CircularProgress,
  Stack,
  ImageList,
  ImageListItem,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Alert,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RichTextEditor } from './RichTextEditor';
import { noteAttachmentAPI } from '../../api/api';
import type { NoteAttachment } from '../../api/types';
import { useTranslation } from '../../i18n';
import { ConfirmationDialog } from '../feedback/ConfirmationDialog';
import { invalidateNoteAttachmentsCache } from './noteAttachmentsCache';
import { markdownComponents } from './markdownComponents';

export interface NotesDrawerProps {
  open: boolean;
  title: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  hasUnsavedChanges?: boolean;
  loading?: boolean;
  noteId?: number;
  focusAttachments?: boolean;
  focusRequestId?: number;
}

const MAX_SIDE = 2560;
const MIN_CROP_SIZE = 24;

type CropRect = { x: number; y: number; width: number; height: number };
type DragMode = 'draw' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se';

async function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = URL.createObjectURL(file);
  });
}

async function renderProcessedFile(file: File, cropRect?: CropRect): Promise<File> {
  const image = await fileToImage(file);
  const crop = cropRect ?? { x: 0, y: 0, width: image.width, height: image.height };

  const rawWidth = Math.max(1, Math.round(crop.width));
  const rawHeight = Math.max(1, Math.round(crop.height));
  const scale = Math.min(1, MAX_SIDE / Math.max(rawWidth, rawHeight));
  const targetWidth = Math.max(1, Math.round(rawWidth * scale));
  const targetHeight = Math.max(1, Math.round(rawHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, targetWidth, targetHeight);

  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
  if (webp) {
    return new File([webp], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
  }

  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!jpeg) throw new Error('Failed to encode image');
  return new File([jpeg], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
}

export function NotesDrawer({ open, title, value, onChange, onSave, onClose, hasUnsavedChanges = false, loading = false, noteId, focusAttachments = false, focusRequestId = 0 }: NotesDrawerProps) {
  const { t } = useTranslation('common');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState<boolean>(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [cameraTimedOut, setCameraTimedOut] = useState<boolean>(false);

  const cropImageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; initialRect: CropRect } | null>(null);
  const attachmentsSectionRef = useRef<HTMLDivElement>(null);
  const cameraFileInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);

  const loadAttachments = async (): Promise<void> => {
    if (!noteId) return;
    const response = await noteAttachmentAPI.list(noteId);
    setAttachments(response.data);
  };

  useEffect(() => {
    if (open) {
      setActiveTab('edit');
      setConfirmDiscardOpen(false);
      void loadAttachments();
    }
  }, [open, noteId]);

  useEffect(() => {
    return () => {
      if (pendingPreviewUrl) {
        URL.revokeObjectURL(pendingPreviewUrl);
      }
    };
  }, [pendingPreviewUrl]);

  const clearPendingSelection = (): void => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
    setCropRect(null);
    setSourceSize(null);
  };



  useEffect(() => {
    if (!open || !focusAttachments) return;
    if (!attachmentsSectionRef.current) return;
    attachmentsSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [open, focusAttachments, focusRequestId, attachments.length]);
  const openCropDialog = (file: File): void => {
    const nextUrl = URL.createObjectURL(file);
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setUploadError('');
    setPendingFile(file);
    setPendingPreviewUrl(nextUrl);
    setCropRect(null);
    setSourceSize(null);
  };

  const cameraStreamRef = useRef<MediaStream | null>(null);

  const closeCamera = (): void => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    setCameraReady(false);
    setCameraTimedOut(false);
  };

  // Stop any active stream if the drawer unmounts while the camera is open.
  useEffect(() => () => cameraStreamRef.current?.getTracks().forEach((track) => track.stop()), []);

  // A ref callback rather than a `[cameraStream]` effect: the <video> lives
  // inside a MUI Dialog, which can mount its content one render after `open`
  // flips to true. An effect keyed on `cameraStream` can fire while the node
  // is still null and never re-run once it exists, leaving the preview
  // permanently black. This runs exactly when the node is actually attached.
  const attachCameraVideo = useCallback((node: HTMLVideoElement | null) => {
    cameraVideoRef.current = node;
    if (!node || !cameraStreamRef.current) return undefined;
    node.srcObject = cameraStreamRef.current;
    // Some browsers don't honor the `autoPlay` attribute when srcObject is
    // assigned imperatively; without this the preview stays black. play()
    // isn't guaranteed to return a promise in every environment (e.g. jsdom).
    void node.play()?.catch(() => {});
    // A stream can be granted by the browser without ever producing a real
    // frame (camera locked by another app, virtual/remote-desktop camera with
    // no signal, ...). Without this, Capture would silently do nothing and
    // the user would be stuck looking at a black box with no explanation.
    const timeoutId = window.setTimeout(() => {
      if (!node.videoWidth) setCameraTimedOut(true);
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const handleTakePhotoClick = async (): Promise<void> => {
    // Touch devices already get the native camera app via the file input's
    // `capture` attribute below — a better experience than a custom in-page
    // stream. Desktop browsers ignore that attribute and just show a file
    // picker (see the "Choose from gallery" button), so open the webcam
    // directly there instead, falling back to the file picker if unavailable.
    const isLikelyTouchDevice = typeof window.matchMedia !== 'function' || window.matchMedia('(pointer: coarse)').matches;
    if (isLikelyTouchDevice || !navigator.mediaDevices?.getUserMedia) {
      cameraFileInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      cameraStreamRef.current = stream;
      setCameraReady(false);
      setCameraTimedOut(false);
      setCameraStream(stream);
    } catch {
      cameraFileInputRef.current?.click();
    }
  };

  const handleCameraFallbackToFilePicker = (): void => {
    closeCamera();
    cameraFileInputRef.current?.click();
  };

  const handleCameraCapture = (): void => {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) openCropDialog(new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' }));
      closeCamera();
    }, 'image/jpeg', 0.92);
  };

  const imagePointFromEvent = (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const img = cropImageRef.current;
    if (!img) return null;
    const bounds = img.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
  };

  const onCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>, mode: DragMode): void => {
    if (event.button !== 0) return;
    const point = imagePointFromEvent(event);
    if (!point) return;
    const initial = cropRect ?? { x: point.x, y: point.y, width: 1, height: 1 };
    dragRef.current = { mode, startX: point.x, startY: point.y, initialRect: initial };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current || !cropImageRef.current) return;
    const point = imagePointFromEvent(event);
    if (!point) return;
    const bounds = cropImageRef.current.getBoundingClientRect();
    const { mode, startX, startY, initialRect } = dragRef.current;

    let next: CropRect = { ...initialRect };

    if (mode === 'draw') {
      next = {
        x: Math.min(startX, point.x),
        y: Math.min(startY, point.y),
        width: Math.max(MIN_CROP_SIZE, Math.abs(point.x - startX)),
        height: Math.max(MIN_CROP_SIZE, Math.abs(point.y - startY)),
      };
    }

    if (mode === 'move') {
      next = {
        ...initialRect,
        x: Math.max(0, Math.min(bounds.width - initialRect.width, initialRect.x + (point.x - startX))),
        y: Math.max(0, Math.min(bounds.height - initialRect.height, initialRect.y + (point.y - startY))),
      };
    }

    if (mode.startsWith('resize')) {
      let left = initialRect.x;
      let top = initialRect.y;
      let right = initialRect.x + initialRect.width;
      let bottom = initialRect.y + initialRect.height;

      if (mode.includes('w')) left = point.x;
      if (mode.includes('e')) right = point.x;
      if (mode.includes('n')) top = point.y;
      if (mode.includes('s')) bottom = point.y;

      left = Math.max(0, Math.min(left, bounds.width - MIN_CROP_SIZE));
      top = Math.max(0, Math.min(top, bounds.height - MIN_CROP_SIZE));
      right = Math.max(left + MIN_CROP_SIZE, Math.min(right, bounds.width));
      bottom = Math.max(top + MIN_CROP_SIZE, Math.min(bottom, bounds.height));

      next = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
    }

    setCropRect(next);
  };

  const onCropPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleUpload = async (): Promise<void> => {
    if (!noteId || !pendingFile) return;
    setUploading(true);
    try {
      const img = cropImageRef.current;
      let sourceCrop: CropRect | undefined;
      if (cropRect && img && sourceSize) {
        const bounds = img.getBoundingClientRect();
        const xScale = sourceSize.width / bounds.width;
        const yScale = sourceSize.height / bounds.height;
        sourceCrop = {
          x: cropRect.x * xScale,
          y: cropRect.y * yScale,
          width: cropRect.width * xScale,
          height: cropRect.height * yScale,
        };
      }

      const processed = await renderProcessedFile(pendingFile, sourceCrop);
      await noteAttachmentAPI.upload(noteId, processed, '', setUploadProgress);
      invalidateNoteAttachmentsCache(noteId);
      await loadAttachments();
      clearPendingSelection();
    } catch (error) {
      const response =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { status?: number; data?: { detail?: string } } }).response
          : undefined;
      const backendDetail = response?.data?.detail;
      const message = response?.status === 503
        ? (backendDetail ?? t('notesDrawer.backendUnavailable'))
        : (backendDetail ?? t('notesDrawer.uploadFailed'));
      setUploadError(message);
      console.error('Error uploading note attachment:', error);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const resetCrop = (): void => {
    const img = cropImageRef.current;
    if (!img) return;
    const bounds = img.getBoundingClientRect();
    setCropRect({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    });
  };

  const closeNestedUi = (): boolean => {
    if (confirmDiscardOpen) {
      setConfirmDiscardOpen(false);
      return true;
    }
    if (selectedImage) {
      setSelectedImage(null);
      return true;
    }
    if (pendingFile) {
      clearPendingSelection();
      return true;
    }
    return false;
  };

  const requestClose = (): void => {
    if (closeNestedUi()) {
      return;
    }
    if (hasUnsavedChanges) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key === 's')) {
      event.preventDefault();
      void handleSaveClick();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    }
  };

  const handleSaveClick = async (): Promise<void> => {
    if (loading) {
      return;
    }
    await onSave();
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={requestClose}
      slotProps={{
        paper: { sx: { width: { xs: '100%', sm: '680px' }, maxWidth: '95vw' } }
      }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 3 }} onKeyDown={handleKeyDown}>
        <Typography variant="h6" gutterBottom>{title}</Typography>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tab label={t('notesDrawer.tabs.edit')} value="edit" />
          <Tab label={t('notesDrawer.tabs.preview')} value="preview" />
        </Tabs>

        {noteId && (
          <Box sx={{ mb: 2 }} ref={attachmentsSectionRef} tabIndex={-1}>
            <Stack
              spacing={1}
              sx={{
                mb: 1.5,
                width: '100%',
                maxWidth: { xs: '100%', sm: 420 },
              }}
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: '100%' }}>
                <Button variant="outlined" sx={{ flex: 1, minHeight: 40 }} onClick={() => { void handleTakePhotoClick(); }}>
                  {t('notesDrawer.takePhoto')}
                  <input
                    ref={cameraFileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) openCropDialog(file);
                      e.target.value = '';
                    }}
                  />
                </Button>
                <Button variant="outlined" component="label" sx={{ flex: 1, minHeight: 40 }}>
                  {t('notesDrawer.selectFromGallery')}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) openCropDialog(file);
                    }}
                  />
                </Button>
              </Stack>
              {uploading ? <Typography variant="body2">{t('notesDrawer.uploading')}</Typography> : null}
            </Stack>
            {uploading && <LinearProgress variant="determinate" value={uploadProgress} />}
            <ImageList cols={4} rowHeight={84}>
              {attachments.map((attachment) => (
                <ImageListItem key={attachment.id}>
                  <img src={attachment.image_url ?? attachment.image} alt={attachment.caption || t('notesDrawer.attachmentAlt')} loading="lazy" style={{ cursor: 'pointer' }} onClick={() => setSelectedImage(attachment.image_url ?? attachment.image)} />
                  <IconButton size="small" aria-label={t('actions.delete')} sx={{ position: 'absolute', right: 2, top: 2, bgcolor: (theme) => alpha(theme.palette.common.black, 0.4), color: 'common.white' }} onClick={async () => {
                    await noteAttachmentAPI.delete(attachment.id);
                    if (noteId) invalidateNoteAttachmentsCache(noteId);
                    await loadAttachments();
 }}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ImageListItem>
              ))}
            </ImageList>
          </Box>
        )}

        <Box sx={{ flexGrow: 1, mb: 2, overflow: 'auto' }}>
          {activeTab === 'edit' ? (
            <RichTextEditor value={value} onChange={onChange} minHeight={260} />
          ) : (
            <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, minHeight: '300px' }}>
              {value ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{value}</ReactMarkdown> : <Typography color="text.secondary" sx={{ fontStyle: "italic", }} >{t('notes.empty')}</Typography>}
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <Button onClick={requestClose} disabled={loading} variant="outlined">{t('actions.cancel')}</Button>
          <Button onClick={() => void handleSaveClick()} disabled={loading} variant="contained" color="primary" startIcon={loading ? <CircularProgress size={16} /> : undefined}>{t('actions.save')}</Button>
        </Box>
      </Box>

      <Dialog open={Boolean(selectedImage)} onClose={() => setSelectedImage(null)} maxWidth="lg" fullWidth>
        <DialogTitle>{t('notesDrawer.imageDialogTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', backgroundColor: 'common.black' }}>{selectedImage && <img src={selectedImage} style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain' }} alt={t('notesDrawer.attachmentPreviewAlt')} />}</DialogContent>
        <DialogActions><Button onClick={() => setSelectedImage(null)}>{t('actions.close')}</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(pendingFile)} onClose={clearPendingSelection} maxWidth="md" fullWidth>
        <DialogTitle>{t('notesDrawer.cropDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>{t('notesDrawer.cropInstructions')}</Typography>
          {uploadError && <Alert severity="error" sx={{ mb: 1 }}>{uploadError}</Alert>}
          <Box
            data-testid="crop-stage"
            sx={{ position: 'relative', width: '100%', maxHeight: 420, overflow: 'auto', userSelect: 'none' }}
            onPointerMove={onCropPointerMove}
            onPointerUp={onCropPointerUp}
            onPointerCancel={onCropPointerUp}
            onPointerDown={(event) => onCropPointerDown(event, 'draw')}
          >
            {pendingPreviewUrl && (
              <img
                ref={cropImageRef}
                src={pendingPreviewUrl}
                alt={t('notesDrawer.cropSourceAlt')}
                style={{ width: '100%', display: 'block' }}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  setSourceSize({ width: img.naturalWidth, height: img.naturalHeight });
                  const bounds = img.getBoundingClientRect();
                  setCropRect({
                    x: 0,
                    y: 0,
                    width: bounds.width,
                    height: bounds.height,
                  });
                }}
              />
            )}
            {cropRect && (
              <>
                <Box sx={{ position: 'absolute', left: cropRect.x, top: cropRect.y, width: cropRect.width, height: cropRect.height, boxShadow: (theme) => `0 0 0 9999px ${alpha(theme.palette.common.black, 0.55)}`, border: '2px solid', borderColor: 'common.white', cursor: 'move' }} onPointerDown={(event) => { event.stopPropagation(); onCropPointerDown(event, 'move'); }} />
                {([
                  { key: 'nw', x: cropRect.x, y: cropRect.y, mode: 'resize-nw', cursor: 'nwse-resize' },
                  { key: 'ne', x: cropRect.x + cropRect.width, y: cropRect.y, mode: 'resize-ne', cursor: 'nesw-resize' },
                  { key: 'sw', x: cropRect.x, y: cropRect.y + cropRect.height, mode: 'resize-sw', cursor: 'nesw-resize' },
                  { key: 'se', x: cropRect.x + cropRect.width, y: cropRect.y + cropRect.height, mode: 'resize-se', cursor: 'nwse-resize' },
                ] as const).map((handle) => (
                  <Box
                    key={handle.key}
                    data-testid={`crop-handle-${handle.key}`}
                    sx={{ position: 'absolute', left: handle.x - 7, top: handle.y - 7, width: 14, height: 14, borderRadius: '50%', border: '2px solid', borderColor: 'common.white', backgroundColor: 'primary.main', cursor: handle.cursor }}
                    onPointerDown={(event) => { event.stopPropagation(); onCropPointerDown(event, handle.mode); }}
                  />
                ))}
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={clearPendingSelection}>{t('actions.cancel')}</Button>
          <Button onClick={resetCrop}>{t('actions.reset')}</Button>
          <Button onClick={() => void handleUpload()} disabled={uploading || !pendingFile} variant="contained">{t('actions.save')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(cameraStream)} onClose={closeCamera} maxWidth="md" fullWidth>
        <DialogTitle>{t('notesDrawer.camera.title')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', p: 0 }}>
          {cameraTimedOut ? (
            <Alert severity="warning" sx={{ m: 2 }}>
              {t('notesDrawer.camera.noSignal')}
            </Alert>
          ) : null}
          <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center', backgroundColor: 'common.black' }}>
            <video
              ref={attachCameraVideo}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => setCameraReady(true)}
              style={{ width: '100%', maxHeight: '70vh' }}
            />
            {!cameraReady && !cameraTimedOut ? (
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress sx={{ color: 'white' }} />
              </Box>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCamera}>{t('actions.cancel')}</Button>
          {cameraTimedOut ? (
            <Button onClick={handleCameraFallbackToFilePicker} variant="contained">{t('notesDrawer.camera.useFilePicker')}</Button>
          ) : (
            <Button onClick={handleCameraCapture} variant="contained" disabled={!cameraReady}>{t('notesDrawer.camera.capture')}</Button>
          )}
        </DialogActions>
      </Dialog>

      <ConfirmationDialog
        open={confirmDiscardOpen}
        fullWidth
        title={t('notesDrawer.unsavedDialog.title')}
        message={t('notesDrawer.unsavedDialog.message')}
        cancelLabel={t('notesDrawer.unsavedDialog.continueEditing')}
        confirmLabel={t('notesDrawer.unsavedDialog.discardAndClose')}
        onCancel={() => setConfirmDiscardOpen(false)}
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          onClose();
        }}
        cancelButtonProps={{ autoFocus: true, color: 'success', variant: 'contained' }}
        confirmButtonProps={{ color: 'error', variant: 'contained' }}
      />
    </Drawer>
  );
}
