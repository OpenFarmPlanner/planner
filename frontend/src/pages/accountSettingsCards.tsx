// Presentational building blocks for the account settings page: success/error
// alerts, the inline editor wrapper, and the settings card shell.

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Collapse,
  Stack,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material';
import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { actionButtonSx, type SectionSubmit } from './accountSettingsForm';

export function SectionAlerts({ message, error }: Pick<SectionSubmit, 'message' | 'error'>) {
  return (
    <>
      {message ? <Alert severity="success">{message}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
    </>
  );
}

interface InlineEditorProps {
  open: boolean;
  saveLabel: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  submitting: boolean;
  saveDisabled?: boolean;
  sx?: SxProps<Theme>;
  children: ReactNode;
}

export function InlineEditor({ open, saveLabel, onSave, onCancel, submitting, saveDisabled = false, sx, children }: InlineEditorProps) {
  const { t } = useTranslation(['account', 'common']);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting || saveDisabled) {
      return;
    }
    onSave();
  };

  return (
    <Collapse in={open} unmountOnExit>
      <Stack component="form" spacing={2} sx={sx} onSubmit={handleSubmit}>
        {children}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <DisabledActionTooltip
            title={submitting
              ? t('common:disabledReasons.busy')
              : saveDisabled
                ? t('common:disabledReasons.requiredFields')
                : ''}
          >
            <Button type="submit" variant="contained" disabled={submitting || saveDisabled} sx={actionButtonSx}>
              {saveLabel}
            </Button>
          </DisabledActionTooltip>
          <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
            <Button type="button" variant="text" onClick={onCancel} disabled={submitting} sx={actionButtonSx}>
              {t('cancel')}
            </Button>
          </DisabledActionTooltip>
        </Stack>
      </Stack>
    </Collapse>
  );
}

interface SettingsCardProps {
  title: ReactNode;
  description?: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function SettingsCard({
  title,
  description,
  collapsible = false,
  defaultExpanded = false,
  children,
}: SettingsCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (collapsible) {
    return (
      <Card>
        <CardContent sx={{ '&:last-child': { pb: expanded ? 3 : 2 } }}>
          <CardActionArea
            component="button"
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            sx={{
              borderRadius: 1,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              minHeight: 44,
              px: 1,
              py: 0.5,
              mx: -1,
              my: -0.5,
              textAlign: 'left',
            }}
          >
            <Typography variant="h6">{title}</Typography>
            <Box
              aria-hidden="true"
              sx={{
                display: 'inline-flex',
                color: 'action.active',
                transition: 'transform 160ms ease-in-out',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            >
              <ExpandMoreIcon fontSize="small" />
            </Box>
          </CardActionArea>
          <Collapse in={expanded} unmountOnExit>
            <Box sx={{ pt: 2 }}>
              {description ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {description}
                </Typography>
              ) : null}
              {children}
            </Box>
          </Collapse>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: description ? 0.5 : 2 }}>
          {title}
        </Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {description}
          </Typography>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}
