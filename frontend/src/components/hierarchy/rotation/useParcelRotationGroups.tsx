import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { parcelRotationAPI } from '../../../api/api';
import type { Bed, Field, ParcelRotationGroup } from '../../../api/types';
import { useTranslation } from '../../../i18n';
import { ParcelRotationGroupsDialog } from './ParcelRotationGroupsDialog';
import type { ParcelRotationLoadStatus, ParcelRotationMembership } from './parcelRotationContext';

interface Options {
  enabled: boolean;
  fields: readonly Field[];
  beds: readonly Bed[];
  onChanged?: () => void;
}

export interface ParcelRotationGroupsState {
  memberships: ReadonlyMap<number, ParcelRotationMembership>;
  /** Whether `memberships` reflects the server yet; an unloaded or failed list is not "unassigned". */
  status: ParcelRotationLoadStatus;
  reload: () => void;
  /** Opens the shared rotation-group dialog, preselecting the parcel's group (or a new one) when given. */
  open: (fieldId?: number) => void;
  dialog: ReactNode;
}

/** Loads the project's parcel rotation groups and owns the one shared management dialog. */
export function useParcelRotationGroups({ enabled, fields, beds, onChanged }: Options): ParcelRotationGroupsState {
  const { t } = useTranslation(['hierarchy', 'common']);
  const [groups, setGroups] = useState<ParcelRotationGroup[]>([]);
  const [dialogState, setDialogState] = useState<{ fieldId?: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await parcelRotationAPI.list();
      setGroups(data);
      setLoadError(false);
      setHasLoaded(true);
    } catch {
      setLoadError(true);
    }
  }, [enabled]);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback((fieldId?: number) => {
    setLoading(true);
    setDialogState({ fieldId });
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const memberships = useMemo(() => new Map<number, ParcelRotationMembership>(groups.flatMap(group => (
    group.parcels.map((parcel, index) => [parcel.id, {
      group: group.name, position: index + 1, size: group.parcels.length,
    }])
  ))), [groups]);

  const reload = useCallback(() => {
    // Until the retry settles the earlier memberships are of unknown validity: show it as loading.
    setLoadError(false);
    setHasLoaded(false);
    void refresh();
  }, [refresh]);
  // A failed refresh (e.g. after saving a group) must not leave older memberships presented as current.
  const status: ParcelRotationLoadStatus = loadError ? 'error' : hasLoaded ? 'ready' : 'loading';

  const close = () => setDialogState(null);
  const dialog = !dialogState ? null : loading || loadError ? (
    <Dialog open fullWidth maxWidth="xs" onClose={close}>
      <DialogTitle>{t('hierarchy:parcelRotation.manage')}</DialogTitle>
      <DialogContent>{loading ? <CircularProgress aria-label={t('common:messages.loading')} />
        : <Alert severity="error">{t('hierarchy:parcelRotation.loadError')}</Alert>}</DialogContent>
      <DialogActions>
        {!loading && <Button onClick={() => open(dialogState.fieldId)}>{t('common:runtime.retryAction')}</Button>}
        <Button onClick={close}>{t('common:actions.cancel')}</Button>
      </DialogActions>
    </Dialog>
  ) : (
    <ParcelRotationGroupsDialog groups={groups} fields={fields} beds={beds} parcelId={dialogState.fieldId}
      onChanged={() => { void refresh(); onChanged?.(); }} onClose={close} />
  );

  return { memberships, status, reload, open, dialog };
}
