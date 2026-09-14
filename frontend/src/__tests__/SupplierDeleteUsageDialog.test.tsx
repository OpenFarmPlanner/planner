import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SupplierDeleteUsageDialog } from '../components/suppliers/SupplierDeleteUsageDialog';
import type { Supplier, SupplierDeleteUsage } from '../api/types';

const supplier = { id: 7, name: 'Reinsaat', homepage_url: '' } as Supplier;

const usage = (overrides: Partial<SupplierDeleteUsage> = {}): SupplierDeleteUsage => ({
  can_delete: false,
  crop_count: 0,
  seed_demand_crop_count: 0,
  supplier_data_crop_count: 0,
  supplier_data_count: 0,
  total_crop_count: 0,
  crop_ids: [],
  ...overrides,
});

interface RenderOptions {
  usage?: SupplierDeleteUsage;
  open?: boolean;
  unlinkDeletingSupplierId?: number | null;
}

const renderDialog = ({
  usage: value = usage({ crop_count: 3, total_crop_count: 3 }),
  open = true,
  unlinkDeletingSupplierId = null,
}: RenderOptions = {}) => {
  const onClose = vi.fn();
  const onOpenAffectedCrops = vi.fn();
  const onUnlinkAndDelete = vi.fn();
  const view = render(
    <MemoryRouter>
      <SupplierDeleteUsageDialog
        dialog={open ? { supplier, usage: value } : null}
        unlinkDeletingSupplierId={unlinkDeletingSupplierId}
        onClose={onClose}
        onOpenAffectedCrops={onOpenAffectedCrops}
        onUnlinkAndDelete={onUnlinkAndDelete}
      />
    </MemoryRouter>,
  );
  return { ...view, onClose, onOpenAffectedCrops, onUnlinkAndDelete };
};

/**
 * The confirmation shown when a supplier cannot simply be deleted because
 * crops still point at it. Its job is to say what will be unlinked before
 * anything is destroyed, so the counts it prints are the substance of it.
 */
describe('SupplierDeleteUsageDialog', () => {
  it('stays closed until there is a supplier to ask about', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the supplier being deleted', () => {
    renderDialog();

    expect(screen.getByText('Reinsaat')).toBeInTheDocument();
  });

  it('summarises with the total, not just the directly linked crops', () => {
    // Two crops link the supplier directly, a third reaches it only through
    // seed planning. Summarising with the direct count would promise a
    // smaller change than the delete actually makes.
    renderDialog({
      usage: usage({ crop_count: 2, seed_demand_crop_count: 1, total_crop_count: 3 }),
    });

    expect(
      screen.getByText('Dieser Lieferant wird noch von 3 Kulturen verwendet.'),
    ).toBeInTheDocument();
  });

  it('uses the singular for a single crop', () => {
    renderDialog({ usage: usage({ crop_count: 1, total_crop_count: 1 }) });

    expect(
      screen.getByText('Dieser Lieferant wird noch von 1 Kultur verwendet.'),
    ).toBeInTheDocument();
  });

  it('lists only the kinds of usage that actually occur', () => {
    renderDialog({ usage: usage({ crop_count: 2, total_crop_count: 2 }) });

    expect(screen.getByText('2 Kulturen nutzen diesen Lieferanten direkt.')).toBeInTheDocument();
    // A zero line would read as a usage the user then cannot find.
    expect(screen.queryByText(/Saatgutplanung/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Saatgut- oder Lieferantendaten/)).not.toBeInTheDocument();
  });

  it('lists seed-planning usage on its own', () => {
    renderDialog({ usage: usage({ seed_demand_crop_count: 4, total_crop_count: 4 }) });

    expect(
      screen.getByText('4 Kulturen nutzen diesen Lieferanten in der Saatgutplanung.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/direkt/)).not.toBeInTheDocument();
  });

  it('reports supplier data as crops and rows, in that order', () => {
    renderDialog({
      usage: usage({ supplier_data_crop_count: 2, supplier_data_count: 9, total_crop_count: 2 }),
    });

    // Two crops holding nine rows between them, not nine crops holding two.
    expect(
      screen.getByText('2 Kulturen haben Saatgut- oder Lieferantendaten mit 9 Einträgen.'),
    ).toBeInTheDocument();
  });

  it('lists every kind of usage at once when all three apply', () => {
    renderDialog({
      usage: usage({
        crop_count: 2,
        seed_demand_crop_count: 1,
        supplier_data_crop_count: 3,
        supplier_data_count: 7,
        total_crop_count: 5,
      }),
    });

    expect(screen.getByText('2 Kulturen nutzen diesen Lieferanten direkt.')).toBeInTheDocument();
    expect(
      screen.getByText('3 Kulturen haben Saatgut- oder Lieferantendaten mit 7 Einträgen.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 Kultur nutzt diesen Lieferanten in der Saatgutplanung.'),
    ).toBeInTheDocument();
  });

  it('promises that the crops themselves survive', () => {
    renderDialog();

    // The whole point of the dialog: this is a delete that unlinks rather
    // than cascading.
    expect(
      screen.getByText(
        'Kulturen werden nicht gelöscht. Vor dem Löschen des Lieferanten wird nur die Lieferantenzuordnung entfernt.',
      ),
    ).toBeInTheDocument();
  });

  it('offers a way to look at the affected crops first', async () => {
    const user = userEvent.setup();
    const { onOpenAffectedCrops, onUnlinkAndDelete } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Zu betroffenen Kulturen' }));

    expect(onOpenAffectedCrops).toHaveBeenCalled();
    expect(onUnlinkAndDelete).not.toHaveBeenCalled();
  });

  it('cancels without deleting', async () => {
    const user = userEvent.setup();
    const { onClose, onUnlinkAndDelete } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(onClose).toHaveBeenCalled();
    expect(onUnlinkAndDelete).not.toHaveBeenCalled();
  });

  it('unlinks and deletes on confirmation', async () => {
    const user = userEvent.setup();
    const { onUnlinkAndDelete, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Lieferant löschen' }));

    expect(onUnlinkAndDelete).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('blocks a second confirmation while this supplier is being deleted', () => {
    renderDialog({ unlinkDeletingSupplierId: 7 });

    expect(screen.getByRole('button', { name: 'Lieferant löschen' })).toBeDisabled();
  });

  it('stays usable while a different supplier is being deleted', () => {
    // Deletes are undoable and run per supplier, so one in flight elsewhere
    // says nothing about this one.
    renderDialog({ unlinkDeletingSupplierId: 99 });

    expect(screen.getByRole('button', { name: 'Lieferant löschen' })).toBeEnabled();
  });
});
