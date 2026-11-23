import { useContext, useId, useMemo, useRef, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material';
import { cropAPI } from '../api/api';
import type { Crop, CropSupplierData } from '../api/types';
import { AuthContext } from '../auth/authContextShared';
import { AppTooltip } from '../components/AppTooltip';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { useTranslation } from '../i18n';
import { buildCropSavePayload, mapSupplierDataRowToInput } from '../pages/cropsSaveUtils';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { currencyForRegion, formatOfferPrice } from '../utils/currency';
import { CropForm } from './CropForm';
import { formatNumber, formatPackageSizes } from './cropDetailFormatters';
import { CropDetailList, CropDetailListRow } from './CropDetailList';

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
  const auth = useContext(AuthContext);
  const membership = auth?.user?.memberships?.find((item) => item.project_id === auth.activeProjectId);
  const defaultOfferCurrency = membership?.project_default_currency || currencyForRegion(membership?.project_region);
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
    const draft = row ?? { supplier_name_input: '', packaging_sizes: [] };
    const packageCurrency = draft.package_currency || defaultOfferCurrency;
    setEditing({
      originalId: row?.id,
      original: row,
      crop: {
        ...crop, supplier_data: [{ ...draft, ...(packageCurrency ? { package_currency: packageCurrency } : {}) }],
      },
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
    {rows.length > 0 && <CropDetailList>
      {rows.map((row, index) => {
        const name = supplierName(row);
        const label = (key: string) => t(`crops:${key}`);
        const packages = row.packaging_sizes ?? [];
        const currency = row.package_currency;
        const noData = label('noData');
        const packageLabel = currency && packages.some((pkg) => pkg.price != null)
          ? packages.flatMap((pkg) => {
            const size = formatPackageSizes([pkg], label, locale);
            if (size === noData) return [];
            return pkg.price == null ? size : `${size} · ${formatOfferPrice(pkg.price, currency, locale)}`;
          }).join(', ')
          : formatPackageSizes(packages, label, locale);
        return <CropDetailListRow
          key={row.id ?? `${row.supplier?.id ?? row.supplier_id ?? 'supplier'}-${index}`}
          name={name}
          description={row.notes}
          metadata={<>
            {(row.supplier_product_name || row.supplier_product_url) && <Box sx={{ minWidth: 0 }}>
              {row.supplier_product_name && <Typography variant="body2">{row.supplier_product_name}</Typography>}
              {row.supplier_product_url && <Link variant="body2" href={row.supplier_product_url}
                target="_blank" rel="noopener noreferrer" underline="hover">{row.supplier_product_url}</Link>}
            </Box>}
            {packageLabel && packageLabel !== noData && <Typography variant="body2" color="text.secondary">
              {t('crops:form.seedPackagesLabel')}: <Box component="span">{packageLabel}</Box>
            </Typography>}
            {row.germination_rate != null && <Typography variant="body2" color="text.secondary">
              {t('crops:supplierData.germination', { rate: formatNumber(row.germination_rate, label, locale) })}
            </Typography>}
            {row.source_url && <Link variant="body2" href={row.source_url} target="_blank"
              rel="noopener noreferrer" underline="hover">{t('crops:supplierData.source')}</Link>}
            {row.price != null && <Typography variant="body2" color="text.secondary">
              {t('crops:supplierData.legacyPrice', { amount: formatNumber(row.price, label, locale) })}
            </Typography>}
          </>}
          disabled={crop.id === undefined || row.id === undefined}
          editLabel={t('crops:supplierData.editNamed', { supplier: name })}
          deleteLabel={t('crops:supplierData.deleteNamed', { supplier: name })}
          onEdit={() => openEditor(row)}
          onDelete={() => { setDeleteError(false); setDeleting(row); }}
        />;
      })}
    </CropDetailList>}
    {editing && <CropForm crop={editing.crop} crops={crops} section="supplierData"
      saveErrorOverride={editError}
      defaultOfferCurrency={defaultOfferCurrency}
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
