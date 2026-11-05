import type { CropSupplierData, CropSupplierDataInput } from '../api/types';

type SupplierDataDraft = CropSupplierData | CropSupplierDataInput;

const hasTextValue = (value: unknown): boolean => (
  typeof value === 'string' && value.trim() !== ''
);

export function hasSelectedSupplier(row: SupplierDataDraft): boolean {
  return (
    typeof row.supplier_id === 'number' ||
    typeof (row as CropSupplierData).supplier?.id === 'number' ||
    hasTextValue(row.supplier_name_input)
  );
}

export function hasSupplierInformation(row: SupplierDataDraft): boolean {
  return (
    hasTextValue(row.supplier_product_name) ||
    hasTextValue(row.supplier_product_url) ||
    hasTextValue(row.supplier_url) ||
    hasTextValue(row.notes) ||
    hasTextValue(row.source_url) ||
    (row.germination_rate !== null && row.germination_rate !== undefined) ||
    (row.price !== null && row.price !== undefined) ||
    Boolean(row.packaging_sizes?.length) ||
    (row.seed_status !== undefined && row.seed_status !== 'unknown') ||
    (row.seed_exemption_status !== undefined && row.seed_exemption_status !== 'unknown')
  );
}

export function isEmptySupplierDataRow(row: SupplierDataDraft): boolean {
  return !hasSelectedSupplier(row) && !hasSupplierInformation(row);
}

export function hasSupplierDataRowMissingSupplier(rows: SupplierDataDraft[] | undefined): boolean {
  return (rows ?? []).some((row) => !hasSelectedSupplier(row) && hasSupplierInformation(row));
}
