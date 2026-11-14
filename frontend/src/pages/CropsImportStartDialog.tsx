import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { useRef, useState } from 'react';
import { CropImportFormatHelp } from './CropImportFormatHelp';

type Translator = (key: string, options?: Record<string, unknown>) => string;

type CropsImportStartDialogProps = {
  open: boolean;
  onClose: () => void;
  onFileSelected: (file: File) => void;
  /** The chosen file is being read and previewed; no other file is accepted meanwhile. */
  preparing?: boolean;
  progressLabel?: string;
  t: Translator;
};

export function CropsImportStartDialog({
  open,
  onClose,
  onFileSelected,
  preparing = false,
  progressLabel,
  t,
}: CropsImportStartDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && !preparing) onFileSelected(file);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file && !preparing) onFileSelected(file);
  };

  return (
    <Dialog open={open} onClose={preparing ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('import.selectFileTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 0.5 }}>
          <Box
            aria-busy={preparing}
            onDragOver={(e) => { e.preventDefault(); if (!preparing) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            sx={{
              position: 'relative',
              border: '2px dashed',
              borderColor: dragOver ? 'primary.main' : 'divider',
              borderRadius: 1,
              p: 3,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1.5,
              backgroundColor: dragOver ? 'action.hover' : 'transparent',
              cursor: preparing ? 'progress' : 'pointer',
              transition: 'border-color 0.15s, background-color 0.15s',
            }}
            onClick={() => { if (!preparing) fileInputRef.current?.click(); }}
          >
            {preparing ? (
              <Box
                role="status"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1.5,
                }}
              >
                <CircularProgress size={32} />
                <Typography variant="body2" sx={{ px: 2, textAlign: 'center' }}>{progressLabel ?? t('import.preparingPreview')}</Typography>
              </Box>
            ) : null}
            {/* Kept in place while preparing so the zone keeps its height. */}
            <Box sx={{ display: 'contents', visibility: preparing ? 'hidden' : 'visible' }}>
              <UploadFileOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv,.xlsx,.ods"
                style={{ display: 'none' }}
                onChange={handleFileChange}
                disabled={preparing}
              />
              <Button
                variant="contained"
                component="span"
                onClick={(e) => { e.stopPropagation(); if (!preparing) fileInputRef.current?.click(); }}
              >
                {t('import.selectFileButton')}
              </Button>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", }} >
                {t('import.supportedFormats')}
              </Typography>
            </Box>
          </Box>
          <CropImportFormatHelp t={t} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={preparing}>
          {t('import.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
