import { useState } from 'react';
import type { GridRenderCellParams } from '@mui/x-data-grid';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { DialogEditCellContext } from '../components/data-grid/DialogEditCellContext';
import { ActualPlanDateCell, type ActualPlanDateDrafts } from '../planting-plans/PlantingPlanDateCells';
import type { PlantingPlanActivity } from '../planting-plans/plantingPlanActualDates';

const planned = '2026-07-01';
const transplantLabel = 'Ist-Pflanztermin';
const activities: [PlantingPlanActivity, string][] = [
  ['propagation', 'Ist-Anzuchtbeginn'],
  ['sowing', 'Ist-Aussaattermin'],
  ['transplanting', transplantLabel],
  ['harvestStart', 'Ist-Erntebeginn'],
  ['harvestEnd', 'Ist-Ernteende'],
];
const localizedLabels = [
  ['de', transplantLabel],
  ['en', 'Actual transplanting date'],
  ['fr', 'Date réelle de plantation'],
  ['es', 'Fecha real de trasplante'],
  ['it', 'Data effettiva di trapianto'],
  ['pt', 'Data efetiva de transplantação'],
  ['nl', 'Werkelijke uitplantdatum'],
];

function Harness({ activity = 'transplanting', actual = null, suggested = planned, save }: {
  activity?: PlantingPlanActivity;
  actual?: string | null;
  suggested?: string | null;
  save: (value: string | null) => Promise<void>;
}) {
  const [token, setToken] = useState(0);
  const [drafts] = useState<ActualPlanDateDrafts>(() => new Map());
  const api = { setCellFocus: vi.fn(), getCellElement: () => null };
  const params = { id: 1, field: 'date', hasFocus: true, api } as unknown as GridRenderCellParams;
  return <DialogEditCellContext.Provider value={{
    request: token ? { cellKey: '1:date', token } : null,
    consumeRequest: () => undefined,
  }}>
    <button onClick={() => setToken(previous => previous + 1)}>Edit cell</button>
    <div role="gridcell">
      <ActualPlanDateCell enabled drafts={drafts} params={params} getEditDates={() => ({ activity, actual, planned: suggested })}
        onSaveActual={(_activity, value) => save(value)}>
        {actual ?? '—'}
      </ActualPlanDateCell>
    </div>
  </DialogEditCellContext.Provider>;
}

const openCell = async (user: ReturnType<typeof userEvent.setup>, name = transplantLabel) => {
  await user.click(screen.getByRole('button', { name: 'Edit cell' }));
  return screen.getByRole('textbox', { name });
};

describe('inline actual date editor', () => {
  it.each(activities)('suggests the plan for %s until explicit confirmation', async (activity, label) => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness activity={activity} save={save} />);
    const input = await openCell(user, label);
    expect(screen.getByRole('gridcell')).toContainElement(input);
    expect(input).toHaveValue('01.07.2026');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(input).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await openCell(user, label);
    await user.keyboard('{Enter}');
    expect(save).toHaveBeenCalledExactlyOnceWith(planned);
  });

  it('clears the stored date and leaves untouched suggestions unrecorded on Tab', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<Harness actual="2026-07-03" save={save} />);
    const input = await openCell(user);
    expect(input).toHaveValue('03.07.2026');
    await user.clear(input);
    await user.keyboard('{Tab}');
    expect(save).toHaveBeenCalledExactlyOnceWith(null);
    await waitFor(() => expect(input).not.toBeInTheDocument());

    view.rerender(<Harness save={save} />);
    await openCell(user);
    await user.keyboard('{Tab}');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps invalid and rejected input available for correction', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockRejectedValueOnce(new Error('Rejected')).mockResolvedValue(undefined);
    render(<Harness save={save} />);
    const input = await openCell(user);
    fireEvent.change(input, { target: { value: '31.02.2026' } });
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('31.02.2026');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Gib ein gültiges Datum ein.');
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '07.07.2026' } });
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('07.07.2026');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.keyboard('{Enter}');
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('2026-07-07');
    await waitFor(() => expect(input).not.toBeInTheDocument());
  });

  it('starts blank without stored or planned data and confirms the native picker selection', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness suggested={null} save={save} />);
    expect(await openCell(user)).toHaveValue('');
    const picker = screen.getByRole('gridcell').querySelector<HTMLInputElement>('input[type="date"]')!;
    fireEvent.change(picker, { target: { value: '2026-07-15' } });
    expect(save).toHaveBeenCalledExactlyOnceWith('2026-07-15');
  });

  it.each(localizedLabels)('labels the actual input in %s', async (language, label) => {
    await i18n.changeLanguage(language);
    const view = render(<Harness save={vi.fn()} />);
    try {
      expect(await openCell(userEvent.setup(), label)).toHaveValue('01.07.2026');
    } finally {
      view.unmount();
      await i18n.changeLanguage('de');
    }
  });
});
