import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Crop, CropSupplierDataInput } from '../api/types';
import { CropSupplierDataSection } from '../crops/CropSupplierDataSection';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const suppliers = vi.hoisted(() => [{ id: 1, name: 'First supplier' }, { id: 2, name: 'Second supplier' }, { id: 3, name: 'Third supplier' }]);
vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: { ...actual.cropAPI, get: api.get, updateSupplierData: api.patch,
      seedRateConstraints: vi.fn().mockResolvedValue({ data: { units: {} } }) },
    supplierAPI: { ...actual.supplierAPI, listAll: vi.fn().mockResolvedValue({ results: suppliers }) },
    plantFamilyAPI: { ...actual.plantFamilyAPI, list: vi.fn().mockResolvedValue({ data: [] }) },
  };
});

const initial: Crop = {
  id: 8, name: 'Carrot', notes: 'Keep crop notes',
  supplier_data: [
    { id: 71, supplier: suppliers[0], supplier_product_name: 'First article', packaging_sizes: [{ size_value: 25, size_unit: 'g' }], seed_status: 'organic' },
    { id: 72, supplier: suppliers[1], supplier_product_name: 'Second article', packaging_sizes: [{ size_value: 250, size_unit: 'seeds' }], price: 3.5, notes: 'Keep offer notes' },
  ],
};
let server: Crop;
function Harness({ crop = initial }: { crop?: Crop }) {
  const [current, setCurrent] = useState(crop);
  return <CropSupplierDataSection crop={current} crops={[current]} onSaved={setCurrent} />;
}
async function editFirst() {
  fireEvent.click(screen.getByRole('button', { name: 'Lieferantendaten bearbeiten: First supplier' }));
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Saatgutlieferant' })).toHaveTextContent('First supplier'));
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Artikelbezeichnung beim Lieferanten' }), { target: { value: 'Updated article' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
  return dialog;
}

describe('CropSupplierDataSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server = structuredClone(initial);
    api.get.mockImplementation(async () => ({ data: structuredClone(server) }));
    api.patch.mockImplementation(async (_id: number, rows: CropSupplierDataInput[]) => {
      server = { ...server, supplier_data: rows.map((row, index) => ({ ...row, id: row.id ?? 90 + index,
        supplier: suppliers.find((supplier) => supplier.id === row.supplier_id) })) };
      return { data: server };
    });
  });

  it('shows an empty state and adds an offer through the focused supplier dialog', async () => {
    server = { ...initial, supplier_data: [] };
    render(<Harness crop={server} />);
    expect(screen.getByText('Noch keine kulturspezifischen Lieferanteninformationen vorhanden.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lieferanteninformation hinzufügen' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(await within(dialog).findByRole('combobox', { name: 'Saatgutlieferant' }));
    fireEvent.click(await screen.findByRole('option', { name: 'First supplier' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Artikelbezeichnung beim Lieferanten' }), { target: { value: 'New article' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('New article')).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith(8, [expect.objectContaining({ supplier_id: 1, supplier_product_name: 'New article' })]);
    expect(server.notes).toBe('Keep crop notes');
  });

  it('merges an edited offer into the latest collection without changing other offers', async () => {
    render(<Harness />);
    server.supplier_data!.push({ id: 73, supplier: suppliers[2], supplier_product_name: 'Added elsewhere', notes: 'Concurrent note', packaging_sizes: [{ size_value: 10, size_unit: 'g' }] });
    const dialog = await editFirst();
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const rows = api.patch.mock.calls[0][1];
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 71, supplier_product_name: 'Updated article', packaging_sizes: [{ size_value: 25, size_unit: 'g' }], seed_status: 'organic' }),
      expect.objectContaining({ id: 72, supplier_product_name: 'Second article', price: 3.5, notes: 'Keep offer notes' }),
      expect.objectContaining({ id: 73, notes: 'Concurrent note' }),
    ]));
    expect(screen.getByText('Added elsewhere')).toBeInTheDocument();
  });

  it('preserves a failed edit and lets the user retry', async () => {
    api.patch.mockRejectedValueOnce(new Error('offline'));
    render(<Harness />);
    const dialog = await editFirst();
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Artikelbezeichnung beim Lieferanten' })).toHaveValue('Updated article');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it.each(['changed', 'removed'])('does not overwrite an offer %s elsewhere', async (change) => {
    render(<Harness />);
    if (change === 'removed') server.supplier_data = server.supplier_data!.slice(1);
    else server.supplier_data![0].notes = 'A newer edit';
    const dialog = await editFirst();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Dieses Angebot wurde inzwischen geändert oder entfernt. Lade die Kultur neu und versuche es erneut.');
    expect(api.patch).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('textbox', { name: 'Artikelbezeichnung beim Lieferanten' })).toHaveValue('Updated article');
  });

  it('confirms deletion, retains the offer on failure and preserves the remaining offer on retry', async () => {
    api.patch.mockRejectedValueOnce(new Error('offline'));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Lieferantendaten löschen: First supplier' }));
    const dialog = screen.getByRole('dialog');
    expect(api.patch).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('First article')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.queryByText('First article')).not.toBeInTheDocument();
    expect(api.patch).toHaveBeenLastCalledWith(8, [expect.objectContaining({ id: 72, supplier_id: 2, notes: 'Keep offer notes' })]);
  });
});
