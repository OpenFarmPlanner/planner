import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import { supplierAPI } from '../../api/api';
import type { Supplier } from '../../api/types';
import { useTranslation } from '../../i18n';
import { wideFieldSx } from '../forms/formLayout';
import { DisabledActionTooltip } from '../DisabledActionTooltip';

interface SupplierDraft {
  name: string;
  homepage_url: string;
}

interface SupplierFieldErrors {
  name?: string;
  homepage_url?: string;
}

interface SupplierFormDialogProps {
  open: boolean;
  supplier?: Supplier | null;
  title?: ReactNode;
  submitLabel?: ReactNode;
  onClose: () => void;
  onSaved: (supplier: Supplier) => Promise<void> | void;
}

const normalizeUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
};

const isValidUrl = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
};

const getFieldErrorValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string').join(' ');
  }
  return undefined;
};

export function SupplierFormDialog({
  open,
  supplier,
  title,
  submitLabel,
  onClose,
  onSaved,
}: SupplierFormDialogProps) {
  const { t } = useTranslation('suppliers');
  const [draft, setDraft] = useState<SupplierDraft>({ name: '', homepage_url: '' });
  const [fieldErrors, setFieldErrors] = useState<SupplierFieldErrors>({});
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const canSave = draft.name.trim().length > 0 && !isSaving;

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft({
      name: supplier?.name ?? '',
      homepage_url: supplier?.homepage_url ?? '',
    });
    setFieldErrors({});
    setError('');
    setIsSaving(false);
    isSavingRef.current = false;

    const focusId = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusId);
  }, [open, supplier]);

  const saveSupplier = async (): Promise<void> => {
    if (!canSave || isSavingRef.current) {
      return;
    }

    try {
      isSavingRef.current = true;
      setIsSaving(true);
      setError('');
      setFieldErrors({});

      const normalizedUrl = normalizeUrl(draft.homepage_url);
      if (normalizedUrl && !isValidUrl(normalizedUrl)) {
        setFieldErrors({ homepage_url: t('invalidUrl') });
        return;
      }

      const payload = {
        name: draft.name.trim(),
        homepage_url: normalizedUrl,
        allowed_domains: [],
      };
      const response = supplier?.id
        ? await supplierAPI.update(supplier.id, payload)
        : await supplierAPI.create(payload.name, payload.homepage_url, []);

      await onSaved(response.data);
      onClose();
    } catch (saveError) {
      console.error('Error saving supplier', saveError);

      if (axios.isAxiosError(saveError) && saveError.response?.data) {
        const errorData = saveError.response.data as Record<string, unknown>;
        const nextFieldErrors = {
          name: getFieldErrorValue(errorData.name),
          homepage_url: getFieldErrorValue(errorData.homepage_url),
        };
        if (nextFieldErrors.name || nextFieldErrors.homepage_url) {
          setFieldErrors(nextFieldErrors);
          return;
        }
      }
      setError(t('saveError'));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void saveSupplier();
  };

  const handleClose = useCallback((): void => {
    if (!isSavingRef.current) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || isSavingRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    };

    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [handleClose, open]);

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogTitle id={titleId}>{title ?? (supplier?.id ? t('edit') : t('create'))}</DialogTitle>
        <DialogContent>
          <TextField
            inputRef={nameInputRef}
            margin="dense"
            sx={wideFieldSx}
            label={t('name')}
            value={draft.name}
            error={Boolean(fieldErrors.name)}
            helperText={fieldErrors.name}
            disabled={isSaving}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((prev) => ({ ...prev, name: value }));
              setFieldErrors((prev) => ({ ...prev, name: undefined }));
            }}
          />
          <TextField
            margin="dense"
            sx={wideFieldSx}
            label={t('homepage')}
            value={draft.homepage_url}
            error={Boolean(fieldErrors.homepage_url)}
            helperText={fieldErrors.homepage_url}
            disabled={isSaving}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((prev) => ({ ...prev, homepage_url: value }));
              setFieldErrors((prev) => ({ ...prev, homepage_url: undefined }));
            }}
          />
          {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <DisabledActionTooltip title={isSaving ? t('common:disabledReasons.busy') : ''}>
            <Button type="button" onClick={handleClose} disabled={isSaving}>{t('cancel')}</Button>
          </DisabledActionTooltip>
          <DisabledActionTooltip title={isSaving ? t('common:disabledReasons.busy') : !canSave ? t('common:disabledReasons.requiredFields') : ''}>
            <Button type="submit" disabled={!canSave} variant="contained" startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : undefined}>
              {submitLabel ?? t('save')}
            </Button>
          </DisabledActionTooltip>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
