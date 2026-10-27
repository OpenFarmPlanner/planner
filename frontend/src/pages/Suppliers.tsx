import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type TouchEvent } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Typography,
  useMediaQuery,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { supplierAPI } from '../api/api';
import { useTranslation } from '../i18n';
import PageContainer from '../components/layout/PageContainer';
import PageSurface from '../components/layout/PageSurface';
import { ContextMenuActionItem } from '../components/contextMenu/ContextMenuActionItem';
import { ContextMenuIndicator } from '../components/contextMenu/ContextMenuIndicator';
import { contextMenuActionsCellSx, contextMenuActionsCellTextSx, contextMenuActionsOverlaySx } from '../components/contextMenu/contextMenuIndicatorStyles';
import { CustomContextMenu } from '../components/contextMenu/CustomContextMenu';
import TableSurface from '../components/layout/TableSurface';
import type { Supplier, SupplierDeleteUndoPayload, SupplierDeleteUsage } from '../api/types';
import {
  SupplierDeleteUsageDialog,
  type SupplierDeleteUsageDialogState,
} from '../components/suppliers/SupplierDeleteUsageDialog';
import { SupplierFormDialog } from '../components/suppliers/SupplierFormDialog';
import { useLocation, useNavigate } from 'react-router';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import EmptyStateCard from '../components/project/EmptyStateCard';
import { useRegisterCreateActions } from '../commands/useCommandContext';
import { ContextMenuHint, DeleteUndoSnackbar, TableCopyMenuItems, useContextMenuHint } from '../components/data-grid';
import { useRowContextMenuState } from '../components/contextMenu/useRowContextMenuState';
import { ROW_LONG_PRESS_MS, useLongPressTimer } from '../components/contextMenu/useLongPressTimer';
import { extractApiErrorMessage } from '../api/errors';
import {
  closestContextMenuElement,
  shouldOpenCustomContextMenu,
  suppressNativeContextMenu,
} from '../utils/contextMenu';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { createTransientId } from '../utils/transientId';

type SupplierLoadStatus = 'idle' | 'loading' | 'success' | 'error';

interface PendingSupplierDeletion {
  id: string;
  supplierId: number;
  supplier: Supplier;
  suppliersBeforeDelete: Supplier[];
  visible: boolean;
  message: string;
  undoPayload?: SupplierDeleteUndoPayload;
}

/**
 * Fallback restore payload for a supplier that was deleted without any
 * remaining crop references — the delete endpoint returns the authoritative
 * payload, this only covers a response without one.
 */
function buildSupplierRestorePayload(supplier: Supplier): SupplierDeleteUndoPayload | undefined {
  if (typeof supplier.id !== 'number') {
    return undefined;
  }
  return {
    supplier: {
      id: supplier.id,
      name: supplier.name,
      homepage_url: supplier.homepage_url ?? '',
      slug: supplier.slug ?? '',
      allowed_domains: supplier.allowed_domains ?? [],
    },
    crop_ids: [],
    seed_demand_crop_ids: [],
    supplier_data: [],
  };
}

function extractDeleteConflictUsage(deleteError: unknown): SupplierDeleteUsage | undefined {
  if (!axios.isAxiosError(deleteError) || deleteError.response?.status !== 409) {
    return undefined;
  }
  const usage = (deleteError.response.data as { usage?: SupplierDeleteUsage } | undefined)?.usage;
  return usage && typeof usage.can_delete === 'boolean' ? usage : undefined;
}

export default function Suppliers() {
  const { t } = useTranslation(['suppliers', 'common']);
  const location = useLocation();
  const navigate = useNavigate();
  const { shouldShowProjectRequiredState, missingProjectReason } = useProjectRequirement();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierLoadStatus, setSupplierLoadStatus] = useState<SupplierLoadStatus>('loading');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [dialogSupplier, setDialogSupplier] = useState<Supplier | null>(null);
  const [pendingSupplierDeletions, setPendingSupplierDeletions] = useState<PendingSupplierDeletion[]>([]);
  const [deleteUsageDialog, setDeleteUsageDialog] = useState<SupplierDeleteUsageDialogState | null>(null);
  const [unlinkDeletingSupplierId, setUnlinkDeletingSupplierId] = useState<number | null>(null);
  const isMobileViewport = useMediaQuery('(max-width:900px)');
  const isTouchLikePointer = useMediaQuery('(pointer: coarse)');
  const shouldShowInlineSupplierActions = !(isMobileViewport || isTouchLikePointer);
  const {
    showContextMenuHint,
    closeContextMenuHint,
    markContextMenuHintUsed,
    showTouchContextMenuHint,
    closeTouchContextMenuHint,
    markTouchContextMenuHintUsed,
  } = useContextMenuHint({
    contextKey: 'suppliers',
    enabled: !shouldShowProjectRequiredState && supplierLoadStatus !== 'error',
    isLoading: supplierLoadStatus === 'loading',
    hasRows: supplierLoadStatus === 'success' && suppliers.length > 0,
  });
  const rowLongPressTimer = useLongPressTimer(ROW_LONG_PRESS_MS);

  const loadSuppliers = useCallback(async (): Promise<void> => {
    setSupplierLoadStatus('loading');
    setLoadError('');
    try {
      const { results } = await supplierAPI.listAll();
      setSuppliers(results);
      setSupplierLoadStatus('success');
    } catch (loadSuppliersError) {
      console.error('Error loading suppliers', loadSuppliersError);
      setSupplierLoadStatus('error');
      setLoadError(t('loadError'));
    }
  }, [t]);

  const openCreate = useCallback((): void => {
    setDialogSupplier(null);
    setError('');
    setDialogOpen(true);
  }, []);

  const createActions = useMemo(() => [
    {
      id: 'create-supplier',
      label: t('create'),
      shortcut: 'Alt+Shift+N',
      disabled: shouldShowProjectRequiredState,
      handler: openCreate,
    },
  ], [openCreate, shouldShowProjectRequiredState, t]);

  useRegisterCreateActions('suppliers-page', createActions);

  useEffect(() => {
    if (shouldShowProjectRequiredState) {
      setSuppliers([]);
      setSupplierLoadStatus('idle');
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void loadSuppliers();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadSuppliers, shouldShowProjectRequiredState]);

  useEffect(() => {
    if (shouldShowProjectRequiredState) {
      return;
    }
    const searchParams = new URLSearchParams(location.search);
    const createIntent = searchParams.get('create');
    if (createIntent !== '1' && createIntent !== 'true') {
      return;
    }

    openCreate();
    searchParams.delete('create');
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, openCreate, shouldShowProjectRequiredState]);

  const openEdit = useCallback((supplier: Supplier): void => {
    setDialogSupplier(supplier);
    setError('');
    setDialogOpen(true);
  }, []);

  const handleSupplierSaved = useCallback(async (): Promise<void> => {
    await loadSuppliers();
  }, [loadSuppliers]);

  const showDeleteError = useCallback((message: string): void => {
    showGlobalSnackbar({ message, severity: 'error' });
  }, []);

  const removePendingSupplierDeletion = useCallback((deletionId: string): void => {
    setPendingSupplierDeletions((currentDeletions) =>
      currentDeletions.filter((deletion) => deletion.id !== deletionId),
    );
  }, []);

  const restorePendingSupplierDeletion = useCallback((deletion: PendingSupplierDeletion): void => {
    setSuppliers((currentSuppliers) => {
      if (currentSuppliers.some((supplier) => supplier.id === deletion.supplierId)) {
        return currentSuppliers;
      }
      const currentById = new Map<number, Supplier>();
      currentSuppliers.forEach((supplier) => {
        if (typeof supplier.id === 'number') {
          currentById.set(supplier.id, supplier);
        }
      });
      currentById.set(deletion.supplierId, deletion.supplier);
      const restoredSuppliers = deletion.suppliersBeforeDelete
        .map((supplier) => (typeof supplier.id === 'number' ? currentById.get(supplier.id) : supplier))
        .filter((supplier): supplier is Supplier => Boolean(supplier));
      const restoredIds = new Set(restoredSuppliers.map((supplier) => supplier.id));
      return [
        ...restoredSuppliers,
        ...currentSuppliers.filter((supplier) => !restoredIds.has(supplier.id)),
      ];
    });
  }, []);

  const restoreSupplierDeletion = useCallback(async (deletion: PendingSupplierDeletion): Promise<void> => {
    if (!deletion.undoPayload) {
      removePendingSupplierDeletion(deletion.id);
      showDeleteError(t('restoreDeleteError'));
      await loadSuppliers();
      return;
    }
    try {
      await supplierAPI.restoreUnlinkedDelete(deletion.undoPayload);
      restorePendingSupplierDeletion(deletion);
      removePendingSupplierDeletion(deletion.id);
      await loadSuppliers();
    } catch (restoreError) {
      console.error('Error restoring supplier deletion', restoreError);
      showDeleteError(extractApiErrorMessage(restoreError, t, t('restoreDeleteError')));
    }
  }, [loadSuppliers, removePendingSupplierDeletion, restorePendingSupplierDeletion, showDeleteError, t]);

  const undoSupplierDeletion = useCallback((deletionId: string): void => {
    const deletion = pendingSupplierDeletions.find((pendingDeletion) => pendingDeletion.id === deletionId);
    if (!deletion) {
      return;
    }

    // The supplier is already deleted in the backend at this point, so undo
    // always means recreating it — never cancelling a pending delete.
    void restoreSupplierDeletion(deletion);
  }, [pendingSupplierDeletions, restoreSupplierDeletion]);

  const closeSupplierDeletionSnackbar = useCallback((deletionId: string): void => {
    removePendingSupplierDeletion(deletionId);
  }, [removePendingSupplierDeletion]);

  const deleteSupplier = useCallback(async (supplier: Supplier): Promise<void> => {
    const supplierId = supplier.id;
    if (!supplierId || pendingSupplierDeletions.some((deletion) => deletion.supplierId === supplierId)) {
      return;
    }

    try {
      setError('');
      const usageResponse = await supplierAPI.deleteUsage(supplierId);
      if (!usageResponse.data.can_delete) {
        setDeleteUsageDialog({ supplier, usage: usageResponse.data });
        return;
      }
    } catch (usageError) {
      console.error('Error checking supplier usage', usageError);
      showDeleteError(extractApiErrorMessage(usageError, t, t('deleteError')));
      return;
    }

    const pendingDeletion: PendingSupplierDeletion = {
      id: createTransientId('supplier', supplierId),
      supplierId,
      supplier,
      suppliersBeforeDelete: suppliers,
      visible: true,
      message: t('messages.deleted'),
      undoPayload: buildSupplierRestorePayload(supplier),
    };

    // The row disappears immediately, but the backend delete below runs right
    // away too: the undo snackbar restores the supplier through the restore
    // endpoint, so a page reload can never bring it back.
    setSuppliers((currentSuppliers) => currentSuppliers.filter((currentSupplier) => currentSupplier.id !== supplierId));

    try {
      const deleteResponse = await supplierAPI.delete(supplierId);
      const undoPayload = deleteResponse?.data?.undo_payload ?? pendingDeletion.undoPayload;
      setPendingSupplierDeletions((currentDeletions) => [...currentDeletions, { ...pendingDeletion, undoPayload }]);
    } catch (deleteError) {
      if (axios.isAxiosError(deleteError) && deleteError.response?.status === 404) {
        await loadSuppliers();
        return;
      }
      restorePendingSupplierDeletion(pendingDeletion);
      const conflictUsage = extractDeleteConflictUsage(deleteError);
      if (conflictUsage) {
        setDeleteUsageDialog({ supplier, usage: conflictUsage });
        return;
      }
      console.error('Error deleting supplier', deleteError);
      showDeleteError(extractApiErrorMessage(deleteError, t, t('deleteError')));
    }
  }, [loadSuppliers, pendingSupplierDeletions, restorePendingSupplierDeletion, showDeleteError, suppliers, t]);

  const openAffectedCrops = useCallback((): void => {
    if (!deleteUsageDialog) {
      return;
    }
    const supplierId = deleteUsageDialog.supplier.id;
    setDeleteUsageDialog(null);
    navigate(typeof supplierId === 'number' ? `/app/crops?supplierId=${supplierId}` : '/app/crops');
  }, [deleteUsageDialog, navigate]);

  const unlinkAndDeleteSupplier = useCallback(async (): Promise<void> => {
    const supplier = deleteUsageDialog?.supplier;
    const supplierId = supplier?.id;
    if (!supplier || typeof supplierId !== 'number') {
      return;
    }
    setUnlinkDeletingSupplierId(supplierId);
    try {
      setError('');
      const response = await supplierAPI.unlinkAndDelete(supplierId);
      const deletionId = createTransientId('supplier-unlink', supplierId);
      const pendingDeletion: PendingSupplierDeletion = {
        id: deletionId,
        supplierId,
        supplier,
        suppliersBeforeDelete: suppliers,
        visible: true,
        message: t('messages.deletedWithUnlinkedCrops', {
          count: response.data.affected_crop_count,
        }),
        undoPayload: response.data.undo_payload,
      };

      setSuppliers((currentSuppliers) => currentSuppliers.filter((currentSupplier) => currentSupplier.id !== supplierId));
      setDeleteUsageDialog(null);
      setPendingSupplierDeletions((currentDeletions) => [...currentDeletions, pendingDeletion]);
    } catch (unlinkError) {
      console.error('Error unlinking and deleting supplier', unlinkError);
      showDeleteError(extractApiErrorMessage(unlinkError, t, t('deleteError')));
    } finally {
      setUnlinkDeletingSupplierId(null);
    }
  }, [deleteUsageDialog, showDeleteError, suppliers, t]);

  const isSupplierContextMenuTarget = useCallback((target: EventTarget | null): boolean => (
    shouldOpenCustomContextMenu(target) &&
    closestContextMenuElement(target, 'tr[data-supplier-id]') !== null
  ), []);
  const {
    state: contextMenuState,
    listRef: contextMenuListRef,
    open: openContextMenuState,
    close: closeContextMenu,
  } = useRowContextMenuState<Supplier>({ isContextMenuTarget: isSupplierContextMenuTarget });

  const openSupplierContextMenu = useCallback((
    event: MouseEvent<HTMLTableRowElement>,
    supplier: Supplier,
  ): void => {
    if (!isSupplierContextMenuTarget(event.target)) {
      return;
    }
    suppressNativeContextMenu(event);
    markContextMenuHintUsed();
    openContextMenuState(supplier, event.clientX + 2, event.clientY - 6, event.currentTarget);
  }, [isSupplierContextMenuTarget, markContextMenuHintUsed, openContextMenuState]);

  const handleSupplierTouchStart = useCallback((
    event: TouchEvent<HTMLTableRowElement>,
    supplier: Supplier,
  ): void => {
    if (event.touches.length !== 1 || !isSupplierContextMenuTarget(event.target)) {
      return;
    }
    const touch = event.touches[0];
    const originElement = event.currentTarget;
    rowLongPressTimer.start(() => {
      markTouchContextMenuHintUsed();
      openContextMenuState(supplier, touch.clientX + 2, touch.clientY - 6, originElement);
    });
  }, [isSupplierContextMenuTarget, markTouchContextMenuHintUsed, openContextMenuState, rowLongPressTimer]);

  const handleSupplierTouchMove = useCallback((): void => {
    rowLongPressTimer.clear();
  }, [rowLongPressTimer]);

  // Clears the timer and, if a long press just fired, suppresses the
  // browser's trailing synthetic click so it doesn't also run the row's own
  // onClick (open the edit dialog) right on top of the context menu the
  // long press just opened.
  const handleSupplierTouchEnd = useCallback((event: TouchEvent<HTMLTableRowElement>): void => {
    rowLongPressTimer.endTouch(event);
  }, [rowLongPressTimer]);

  const openSupplierKeyboardContextMenu = useCallback((
    event: KeyboardEvent<HTMLTableRowElement>,
    supplier: Supplier,
  ): void => {
    const shouldOpenContextMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!shouldOpenContextMenu) {
      return;
    }

    suppressNativeContextMenu(event);
    markContextMenuHintUsed();
    const rowRect = event.currentTarget.getBoundingClientRect();
    openContextMenuState(
      supplier,
      rowRect.left + Math.min(240, rowRect.width),
      rowRect.top + 12,
      event.currentTarget,
    );
  }, [markContextMenuHintUsed, openContextMenuState]);

  const handleContextMenuDelete = useCallback((): void => {
    if (!contextMenuState) {
      return;
    }
    const { key: supplier } = contextMenuState;
    closeContextMenu();
    void deleteSupplier(supplier);
  }, [closeContextMenu, contextMenuState, deleteSupplier]);

  const handleContextMenuEdit = useCallback((): void => {
    if (!contextMenuState) {
      return;
    }
    const { key: supplier } = contextMenuState;
    closeContextMenu();
    openEdit(supplier);
  }, [closeContextMenu, contextMenuState, openEdit]);

  const openSupplierInlineActionMenu = useCallback((event: MouseEvent<HTMLButtonElement>, supplier: Supplier): void => {
    event.preventDefault();
    event.stopPropagation();
    markContextMenuHintUsed();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenuState(supplier, rect.right - 8, rect.top + 12, event.currentTarget);
  }, [markContextMenuHintUsed, openContextMenuState]);

  const getSupplierRowClipboardValues = useCallback((supplier: Supplier): string[] => [
    supplier.name,
    supplier.homepage_url ?? '',
  ], []);

  const getSupplierTableClipboardRows = useCallback((): string[][] => [
    [t('name'), t('homepage')],
    ...suppliers.map(getSupplierRowClipboardValues),
  ], [getSupplierRowClipboardValues, suppliers, t]);

  if (shouldShowProjectRequiredState && missingProjectReason) {
    return (
      <PageContainer variant="xwide">
        <Box sx={{ width: '100%' }}>
          <ProjectRequiredState reason={missingProjectReason} />
        </Box>
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="compactCenteredPage">
      <PageSurface variant="compact">
        {loadError ? <Alert severity="error" sx={{ mb: 2, width: '100%', maxWidth: 880 }}>{loadError}</Alert> : null}
        {!dialogOpen && error ? <Alert severity="error" sx={{ mb: 2, width: '100%', maxWidth: 880 }}>{error}</Alert> : null}
        {supplierLoadStatus === 'loading' ? (
          <Box
            sx={{
              width: '100%',
              maxWidth: 880,
              minHeight: 180,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1.5,
              color: 'text.secondary',
            }}
          >
            <CircularProgress size={22} />
            <Typography variant="body2">{t('common:messages.loading')}</Typography>
          </Box>
        ) : null}
        {supplierLoadStatus === 'success' && suppliers.length === 0 ? (
          <Box sx={{ width: '100%', maxWidth: 880 }}>
            <EmptyStateCard
              title={t('emptyState.title')}
              description={t('emptyState.description')}
              actions={[{ label: t('create'), to: '/app/suppliers?create=true' }]}
            />
          </Box>
        ) : null}
        {showContextMenuHint ? (
          <ContextMenuHint
            variant="desktop"
            message={t('common:messages.contextMenuTableHint')}
            onClose={closeContextMenuHint}
            sx={{ mb: 1.25, width: '100%', maxWidth: 880 }}
          />
        ) : null}
        {showTouchContextMenuHint ? (
          <ContextMenuHint
            variant="touch"
            message={t('common:messages.contextMenuTableHintTouch')}
            onClose={closeTouchContextMenuHint}
            sx={{ mb: 1.25, width: '100%', maxWidth: 880 }}
          />
        ) : null}
        {supplierLoadStatus === 'success' && suppliers.length > 0 ? (
          <TableSurface sizingMode="compact">
          <TableContainer>
            <Table size="medium">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ py: 1.5, minWidth: { xs: 150, sm: 180 } }}>{t('name')}</TableCell>
                  <TableCell sx={{ py: 1.5, minWidth: { xs: 170, sm: 260 } }}>{t('homepage')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {suppliers.map((supplier) => (
                  <TableRow
                    key={supplier.id}
                    data-supplier-id={supplier.id}
                    hover
                    tabIndex={0}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a, button')) {
                        return;
                      }
                      openEdit(supplier);
                    }}
                    onContextMenu={(event) => openSupplierContextMenu(event, supplier)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        openEdit(supplier);
                        return;
                      }
                      openSupplierKeyboardContextMenu(event, supplier);
                    }}
                    onTouchStart={(event) => handleSupplierTouchStart(event, supplier)}
                    onTouchMove={handleSupplierTouchMove}
                    onTouchEnd={handleSupplierTouchEnd}
                    onTouchCancel={handleSupplierTouchMove}
                    sx={{
                      cursor: 'pointer',
                      WebkitTouchCallout: 'none',
                    }}
                  >
                    <TableCell sx={{ py: 1.25, maxWidth: { xs: 180, sm: 240 } }}>
                      <Box
                        sx={contextMenuActionsCellSx}
                      >
                        <Box
                          component="span"
                          sx={contextMenuActionsCellTextSx}
                        >
                          {supplier.name}
                        </Box>
                        {shouldShowInlineSupplierActions ? (
                          <Box
                            className="supplier-row-actions"
                            sx={contextMenuActionsOverlaySx('tr:hover &', 'tr:has(:focus-visible) &')}
                          >
                            <IconButton
                              size="small"
                              color="primary"
                              aria-label={t('editAction')}
                              onClick={() => openEdit(supplier)}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              color="error"
                              aria-label={t('deleteAction')}
                              onClick={() => void deleteSupplier(supplier)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                            <ContextMenuIndicator
                              label={t('common:actions.actions')}
                              onClick={(event) => openSupplierInlineActionMenu(event, supplier)}
                            />
                          </Box>
                        ) : null}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ py: 1.25 }}>
                      {supplier.homepage_url ? (
                        <Link href={supplier.homepage_url} target="_blank" rel="noopener noreferrer" underline="hover">
                          {supplier.homepage_url}
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          </TableSurface>
        ) : null}
      </PageSurface>

      <CustomContextMenu
        open={contextMenuState !== null}
        onClose={closeContextMenu}
        keyboardNavigation
        listRef={contextMenuListRef}
        mouseX={contextMenuState?.mouseX}
        mouseY={contextMenuState?.mouseY}
      >
        <ContextMenuActionItem
          label={t('editAction')}
          icon={<EditIcon fontSize="small" />}
          onClick={handleContextMenuEdit}
        />
        <ContextMenuActionItem
          label={t('deleteAction')}
          icon={<DeleteIcon fontSize="small" />}
          color="error"
          onClick={handleContextMenuDelete}
        />
        <TableCopyMenuItems
          rowValues={contextMenuState ? getSupplierRowClipboardValues(contextMenuState.key) : null}
          tableRows={getSupplierTableClipboardRows()}
          includeDivider
          onClose={closeContextMenu}
        />
      </CustomContextMenu>

      <SupplierFormDialog
        open={dialogOpen}
        supplier={dialogSupplier}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSupplierSaved}
      />

      <SupplierDeleteUsageDialog
        dialog={deleteUsageDialog}
        unlinkDeletingSupplierId={unlinkDeletingSupplierId}
        onClose={() => setDeleteUsageDialog(null)}
        onOpenAffectedCrops={openAffectedCrops}
        onUnlinkAndDelete={() => void unlinkAndDeleteSupplier()}
      />

      {pendingSupplierDeletions.map((deletion, index) => (
        <DeleteUndoSnackbar
          key={deletion.id}
          open={deletion.visible}
          message={deletion.message}
          undoLabel={t('common:actions.undo')}
          offsetIndex={index}
          testId="supplier-delete-snackbar"
          onClose={() => closeSupplierDeletionSnackbar(deletion.id)}
          onUndo={() => undoSupplierDeletion(deletion.id)}
        />
      ))}
    </PageContainer>
  );
}
