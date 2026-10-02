// Crop-library API-token management for the account settings page.
//
// A separate credential from accountSettingsApiTokensCard's project-bound
// tokens: platform-wide, superuser-only, and reaching only the official
// crop-species API (never a project's own data). See
// docs/crop-library-api-tokens.md. This card renders nothing for a
// non-superuser — the backend would reject creation anyway, but hiding the
// card avoids showing a button that always 403s.

import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef, type GridSortModel } from '@mui/x-data-grid';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { cropLibraryTokenAPI } from '../api/api';
import { CROP_LIBRARY_TOKEN_DOCS_URL } from '../api/apiDocsUrl';
import type { CropLibraryToken, CropLibraryTokenCreated, CropLibraryTokenScope } from '../api/types';
import { extractApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/useAuth';
import { useTranslation } from '../i18n';
import { getDataGridLocaleText } from '../components/data-grid/localeText';
import { mediumStackedFieldSx, wideSingleColumnFieldSx } from '../components/forms/formLayout';
import { actionButtonSx } from './accountSettingsForm';
import { InlineEditor, SectionAlerts, SettingsCard } from './accountSettingsCards';

const SCOPES: CropLibraryTokenScope[] = ['read', 'write'];

function formatMoment(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toLocaleString();
}

function isInactiveToken(token: CropLibraryToken): boolean {
  if (token.status === 'revoked' || token.status === 'expired' || token.revoked_at) {
    return true;
  }
  if (!token.expires_at) {
    return false;
  }
  const expiresAt = new Date(token.expires_at);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt < new Date();
}

interface CropLibraryTokenTableProps {
  tokens: CropLibraryToken[];
  onRevoke: (token: CropLibraryToken) => void;
  showActions?: boolean;
}

const TOKEN_SORT_MODEL: GridSortModel = [{ field: 'created_at', sort: 'desc' }];

function getTimestamp(value: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function CropLibraryTokenTable({ tokens, onRevoke, showActions = true }: CropLibraryTokenTableProps) {
  const { t } = useTranslation('account');

  const columns = useMemo<GridColDef<CropLibraryToken>[]>(
    () => {
      const baseColumns: GridColDef<CropLibraryToken>[] = [
        {
          field: 'name',
          headerName: t('cropLibraryToken.columns.name'),
          flex: 1.7,
          minWidth: 240,
          renderCell: (params) => (
            <Typography
              variant="body2"
              title={`${t('cropLibraryToken.meta.prefix')}: ${params.row.token_prefix}...`}
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {params.value}
            </Typography>
          ),
        },
        {
          field: 'scope',
          headerName: t('cropLibraryToken.columns.scope'),
          flex: 1,
          minWidth: 140,
          renderCell: (params) => (
            <Chip size="small" variant="outlined" label={t(`cropLibraryToken.scopes.${params.value}`)} />
          ),
        },
        {
          field: 'created_at',
          headerName: t('cropLibraryToken.columns.created'),
          flex: 1,
          minWidth: 150,
          valueGetter: (_value, row) => getTimestamp(row.created_at),
          valueFormatter: (value) => formatMoment(new Date(value as number).toISOString(), '–'),
        },
        {
          field: 'expires_at',
          headerName: t('cropLibraryToken.columns.expires'),
          flex: 1,
          minWidth: 150,
          valueGetter: (_value, row) => getTimestamp(row.expires_at),
          valueFormatter: (value) => {
            const timestamp = value as number;
            return timestamp === 0
              ? t('cropLibraryToken.meta.never')
              : formatMoment(new Date(timestamp).toISOString(), '–');
          },
        },
        {
          field: 'last_used_at',
          headerName: t('cropLibraryToken.columns.lastUsed'),
          flex: 1,
          minWidth: 150,
          valueGetter: (_value, row) => getTimestamp(row.last_used_at),
          valueFormatter: (value) => {
            const timestamp = value as number;
            return timestamp === 0
              ? t('cropLibraryToken.meta.neverUsed')
              : formatMoment(new Date(timestamp).toISOString(), '–');
          },
        },
      ];

      if (!showActions) {
        return baseColumns;
      }

      return [
        ...baseColumns,
        {
          field: 'actions',
          headerName: t('cropLibraryToken.columns.action'),
          width: 150,
          minWidth: 150,
          sortable: false,
          filterable: false,
          align: 'right',
          headerAlign: 'right',
          renderCell: (params) => (
            params.row.status === 'active' ? (
              <Button
                color="error"
                variant="outlined"
                size="small"
                sx={actionButtonSx}
                onClick={() => onRevoke(params.row)}
              >
                {t('cropLibraryToken.actions.revoke')}
              </Button>
            ) : null
          ),
        },
      ];
    },
    [onRevoke, showActions, t],
  );

  return (
    <DataGrid<CropLibraryToken>
      rows={tokens}
      columns={columns}
      autoHeight
      hideFooter
      disableRowSelectionOnClick
      initialState={{ sorting: { sortModel: TOKEN_SORT_MODEL } }}
      localeText={getDataGridLocaleText()}
      sx={{
        width: '100%',
        borderColor: 'divider',
        '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 },
        '& .MuiDataGrid-cell': { alignItems: 'center' },
      }}
    />
  );
}

export default function AccountSettingsCropLibraryTokenCard() {
  const { t } = useTranslation('account');
  const { user } = useAuth();

  const [tokens, setTokens] = useState<CropLibraryToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<CropLibraryTokenCreated | null>(null);
  const [inactiveTokensOpen, setInactiveTokensOpen] = useState(false);

  const [name, setName] = useState('');
  const [scope, setScope] = useState<CropLibraryTokenScope>('read');
  const [expiresAt, setExpiresAt] = useState('');

  const isSuperuser = user?.is_superuser ?? false;

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const response = await cropLibraryTokenAPI.list();
      setTokens(response.data);
    } catch (error) {
      setListError(extractApiErrorMessage(error, t, t('errors.generic')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isSuperuser) {
      void loadTokens();
    }
  }, [isSuperuser, loadTokens]);

  const { activeTokens, inactiveTokens } = useMemo(() => {
    const nextActiveTokens: CropLibraryToken[] = [];
    const nextInactiveTokens: CropLibraryToken[] = [];

    for (const token of tokens) {
      if (isInactiveToken(token)) {
        nextInactiveTokens.push(token);
      } else {
        nextActiveTokens.push(token);
      }
    }

    return { activeTokens: nextActiveTokens, inactiveTokens: nextInactiveTokens };
  }, [tokens]);

  const resetForm = () => {
    setName('');
    setScope('read');
    setExpiresAt('');
    setFormError(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    resetForm();
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setMessage(null);
    try {
      const response = await cropLibraryTokenAPI.create({
        name: name.trim(),
        scope,
        expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      });
      setCreatedToken(response.data);
      closeForm();
      await loadTokens();
    } catch (error) {
      setFormError(extractApiErrorMessage(error, t, t('errors.generic')));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (token: CropLibraryToken) => {
    setMessage(null);
    setListError(null);
    try {
      await cropLibraryTokenAPI.revoke(token.id);
      setMessage(t('cropLibraryToken.revoked', { name: token.name }));
      await loadTokens();
    } catch (error) {
      setListError(extractApiErrorMessage(error, t, t('errors.generic')));
    }
  };

  if (!isSuperuser) {
    return null;
  }

  return (
    <SettingsCard
      title={t('cropLibraryToken.title')}
      description={t('cropLibraryToken.description')}
      collapsible
      defaultExpanded
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          <Link href={CROP_LIBRARY_TOKEN_DOCS_URL} target="_blank" rel="noopener noreferrer" underline="hover">
            {t('cropLibraryToken.docsLink')}
          </Link>
        </Typography>
        <SectionAlerts message={message} error={listError} />

        {loading ? (
          <Typography variant="body2" color="text.secondary">
            {t('cropLibraryToken.loading')}
          </Typography>
        ) : tokens.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('cropLibraryToken.empty')}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {activeTokens.length > 0 ? (
              <CropLibraryTokenTable tokens={activeTokens} onRevoke={(token) => void handleRevoke(token)} />
            ) : null}
            {inactiveTokens.length > 0 ? (
              <Box>
                <Button
                  type="button"
                  variant="text"
                  sx={actionButtonSx}
                  onClick={() => setInactiveTokensOpen((open) => !open)}
                  aria-expanded={inactiveTokensOpen}
                >
                  {t('cropLibraryToken.inactiveToggle', { count: inactiveTokens.length })}
                </Button>
                <Collapse in={inactiveTokensOpen} unmountOnExit>
                  <Box sx={{ pt: 1.5 }}>
                    <CropLibraryTokenTable
                      tokens={inactiveTokens}
                      onRevoke={(token) => void handleRevoke(token)}
                      showActions={false}
                    />
                  </Box>
                </Collapse>
              </Box>
            ) : null}
          </Stack>
        )}

        <Box>
          {!formOpen ? (
            <Button variant="outlined" sx={actionButtonSx} onClick={() => setFormOpen(true)}>
              {t('cropLibraryToken.actions.create')}
            </Button>
          ) : null}
        </Box>

        <InlineEditor
          open={formOpen}
          saveLabel={t('cropLibraryToken.actions.create')}
          onSave={() => void handleCreate()}
          onCancel={closeForm}
          submitting={submitting}
          saveDisabled={!name.trim()}
        >
          {formError ? <Alert severity="error">{formError}</Alert> : null}
          <TextField
            label={t('cropLibraryToken.form.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={wideSingleColumnFieldSx}
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <TextField
            select
            label={t('cropLibraryToken.form.scope')}
            value={scope}
            onChange={(event) => setScope(event.target.value as CropLibraryTokenScope)}
            sx={mediumStackedFieldSx}
            helperText={t(`cropLibraryToken.scopeHelp.${scope}`)}
          >
            {SCOPES.map((value) => (
              <MenuItem key={value} value={value}>
                {t(`cropLibraryToken.scopes.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="date"
            label={t('cropLibraryToken.form.expiresAt')}
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            sx={mediumStackedFieldSx}
            helperText={t('cropLibraryToken.form.expiresAtHelper')}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </InlineEditor>
      </Stack>

      <Dialog open={createdToken !== null} onClose={() => setCreatedToken(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('cropLibraryToken.created.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">{t('cropLibraryToken.created.warning')}</Alert>
            <DialogContentText>{t('cropLibraryToken.created.description')}</DialogContentText>
            <TextField
              label={t('cropLibraryToken.created.tokenLabel')}
              value={createdToken?.token ?? ''}
              multiline
              minRows={2}
              sx={wideSingleColumnFieldSx}
              slotProps={{ htmlInput: { readOnly: true, 'aria-label': t('cropLibraryToken.created.tokenLabel') } }}
            />
            <DialogContentText>{t('cropLibraryToken.created.usageHint')}</DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setCreatedToken(null)}>
            {t('cropLibraryToken.created.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsCard>
  );
}
