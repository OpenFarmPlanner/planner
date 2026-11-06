import { useId, useMemo, useRef, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Alert, Box, Button, Divider, Link, Stack, Typography } from '@mui/material';
import { cropAPI } from '../api/api';
import type { Crop, CropSupplierData } from '../api/types';
import { AppTooltip } from '../components/AppTooltip';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { useTranslation } from '../i18n';
import { buildCropSavePayload, mapSupplierDataRowToInput } from '../pages/cropsSaveUtils';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { CropForm } from './CropForm';
import { formatPackageSizes } from './cropDetailFormatters';

interface CropSupplierDataSectionProps {
  crop: Crop;
  crops: Crop[];
  onSaved?: (crop: Crop) => void;
}

interface EditingOffer {
  originalId?: number;
  original?: CropSupplierData;
  crop: Crop;
}

export function CropSupplierDataSection({ crop, crops, onSaved }: CropSupplierDataSectionProps) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const titleId = useId();
  const [editing, setEditing] = useState<EditingOffer | null>(null);
  const [deleting, setDeleting] = useState<CropSupplierData | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [editError, setEditError] = useState('');
  const lock = useRef(false);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const rows = useMemo(() => {
    const offers = crop.supplier_data ?? [];
    const preferred = crop.supplier?.id ?? crop.selected_seed_demand_supplier;
    return [...offers].sort((a, b) =>
      Number((b.supplier?.id ?? b.supplier_id) === preferred)
      - Number((a.supplier?.id ?? a.supplier_id) === preferred));
  }, [crop.supplier_data, crop.supplier?.id, crop.selected_seed_demand_supplier]);
  const supplierName = (row: CropSupplierData) => row.supplier?.name || row.supplier_name || t('crops:form.supplier');
  const openEditor = (row?: CropSupplierData) => {
    setEditError('');
    setEditing({
      originalId: row?.id,
      original: row,
      crop: { ...crop, supplier_data: [row ?? { supplier_name_input: '', packaging_sizes: [] }] },
    });
  };

  const saveOffer = async (draft: Crop) => {
    if (!editing || crop.id === undefined) return;
    setEditError('');
    // Supplier writes replace the collection. Merge into a fresh read so an
    // independently added offer or unrelated crop edit is preserved.
    const latest = (await cropAPI.get(crop.id)).data;
    const existing = latest.supplier_data ?? [];
    if (editing.originalId !== undefined && editing.original) {
      const current = existing.find((row) => row.id === editing.originalId);
      if (!current || JSON.stringify(mapSupplierDataRowToInput(current))
        !== JSON.stringify(mapSupplierDataRowToInput(editing.original))) {
        setEditError(t('crops:supplierData.changed'));
        throw new Error('Supplier offer changed while editing');
      }
    }
    const replacement = buildCropSavePayload(draft).supplier_data_input ?? [];
    const remaining = existing.filter((row) => row.id !== editing.originalId).map(mapSupplierDataRowToInput);
    const response = await cropAPI.updateSupplierData(crop.id, [...remaining, ...replacement]);
    onSaved?.(response.data);
    setEditing(null);
  };

  const remove = async () => {
    if (!deleting || crop.id === undefined || lock.current) return;
    lock.current = true;
    setBusy(true);
    setDeleteError(false);
    try {
      const latest = (await cropAPI.get(crop.id)).data;
      if (!(latest.supplier_data ?? []).some((row) => row.id === deleting.id)) {
        onSaved?.(latest);
        setDeleting(null);
        return;
      }
      const remaining = (latest.supplier_data ?? []).filter((row) => row.id !== deleting.id);
      const response = await cropAPI.updateSupplierData(crop.id, remaining.map(mapSupplierDataRowToInput));
      onSaved?.(response.data);
      setDeleting(null);
    } catch {
      setDeleteError(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return <Box component="section" aria-labelledby={titleId}
    sx={{ mb: 3, p: { xs: 1.25, sm: 2 }, border: '1px solid', borderColor: 'surface.surfaceBorder', borderRadius: 2, minWidth: 0 }}>
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography id={titleId} variant="h6">{t('crops:supplierData.title')}</Typography>
        <AppTooltip title={t('crops:form.supplierDataSectionDescription')}>
          <Box component="span" tabIndex={0} sx={{ display: 'inline-flex', color: 'text.secondary' }}>
            <InfoOutlinedIcon fontSize="small" />
          </Box>
        </AppTooltip>
      </Stack>
      <Button variant="outlined" startIcon={<AddIcon />} disabled={crop.id === undefined}
        onClick={() => openEditor()}>{t('crops:form.addSupplierData')}</Button>
    </Stack>
    {rows.length === 0 && <Typography variant="body2" color="text.secondary">{t('crops:form.noSupplierDataRows')}</Typography>}
    <Stack divider={<Divider />} spacing={1.5}>
      {rows.map((row, index) => <Stack key={row.id ?? `${row.supplier?.id ?? row.supplier_id ?? 'supplier'}-${index}`} spacing={1} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', gap: 0.5 }}>
          <Typography variant="subtitle2">{supplierName(row)}</Typography>
          <Stack direction="row" spacing={0.5}>
            <Button disabled={crop.id === undefined || row.id === undefined} onClick={() => openEditor(row)}
              aria-label={t('crops:supplierData.editNamed', { supplier: supplierName(row) })}>{t('common:actions.edit')}</Button>
            <Button color="error" disabled={crop.id === undefined || row.id === undefined}
              onClick={() => { setDeleteError(false); setDeleting(row); }}
              aria-label={t('crops:supplierData.deleteNamed', { supplier: supplierName(row) })}>{t('common:actions.delete')}</Button>
          </Stack>
        </Stack>
        {row.supplier_product_name && <Typography variant="body2">{row.supplier_product_name}</Typography>}
        {row.supplier_product_url && <Link href={row.supplier_product_url} target="_blank" rel="noopener noreferrer" underline="hover">{row.supplier_product_url}</Link>}
        <Typography variant="body2" color="text.secondary">{t('crops:form.seedPackagesLabel')}: <Box component="span">{formatPackageSizes(row.packaging_sizes, (key) => t(`crops:${key}`), locale)}</Box></Typography>
      </Stack>)}
    </Stack>
    {editing && <CropForm crop={editing.crop} crops={crops} section="supplierData"
      saveErrorOverride={editError}
      formKind={crop.variety?.trim() ? 'variety' : 'crop'}
      title={t('crops:form.supplierDataSectionTitle')} onCancel={() => setEditing(null)} onSave={saveOffer} />}
    <ConfirmationDialog open={Boolean(deleting)} title={t('crops:supplierData.delete')}
      message={<>{t('crops:supplierData.deleteConfirm', { supplier: deleting ? supplierName(deleting) : '' })}
        {deleteError && <Alert severity="error">{t('crops:supplierData.deleteError')}</Alert>}</>}
      messageTypographyProps={{ component: 'div' }} cancelLabel={t('common:actions.cancel')}
      confirmLabel={t('common:actions.delete')} onCancel={() => { if (!busy) setDeleting(null); }}
      onConfirm={() => { void remove(); }} cancelButtonProps={{ disabled: busy }}
      confirmButtonProps={{ disabled: busy, color: 'error' }} />
  </Box>;
}
