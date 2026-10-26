import {
  Box,
  Button,
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
  t: Translator;
};

export function CropsImportStartDialog({
  open,
  onClose,
  onFileSelected,
  t,
}: CropsImportStartDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onFileSelected(file);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) onFileSelected(file);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('import.selectFileTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 0.5 }}>
          <Box
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            sx={{
              border: '2px dashed',
              borderColor: dragOver ? 'primary.main' : 'divider',
              borderRadius: 1,
              p: 3,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1.5,
              backgroundColor: dragOver ? 'action.hover' : 'transparent',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background-color 0.15s',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadFileOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv,.xlsx,.ods"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <Button
              variant="contained"
              component="span"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            >
              {t('import.selectFileButton')}
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", }} >
              {t('import.supportedFormats')}
            </Typography>
          </Box>
          <CropImportFormatHelp t={t} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          {t('import.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
