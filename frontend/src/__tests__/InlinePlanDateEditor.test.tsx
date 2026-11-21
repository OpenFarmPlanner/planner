import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { InlinePlanDateEditor } from '../planting-plans/PlantingPlanDateCells';
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

const localizedTransplantLabels = [
  ['de', 'Plan', transplantLabel],
  ['en', 'Planned', 'Actual transplanting date'],
  ['fr', 'Prévu', 'Date réelle de plantation'],
  ['es', 'Previsto', 'Fecha real de trasplante'],
  ['it', 'Previsto', 'Data effettiva di trapianto'],
  ['pt', 'Planeado', 'Data efetiva de transplantação'],
  ['nl', 'Gepland', 'Werkelijke uitplantdatum'],
];

describe('inline actual date editor', () => {
  it.each(activities)('suggests the planned date for %s until the user saves', async (activity, label) => {
    const user = userEvent.setup();
    const saveActual = vi.fn().mockResolvedValue(undefined);
    render(<InlinePlanDateEditor dates={{ activity, planned, actual: null }} mode="actual" hasFocus onSaveActual={saveActual} />);
    const action = screen.getByRole('button', { name: label });
    await user.click(action);
    const editor = screen.getByRole('dialog', { name: label });
    const field = within(editor).getByLabelText(label);
    expect(field).toHaveValue(planned);
    expect(field).toHaveAccessibleDescription('Am geplanten Tag');
    expect(within(editor).getByText('Plan', { exact: true }).parentElement).toHaveTextContent('Plan 1.7.2026');
    expect(saveActual).not.toHaveBeenCalled();

    await user.click(within(editor).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(editor).not.toBeInTheDocument());
    expect(saveActual).not.toHaveBeenCalled();
    await user.click(action);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }));
    expect(saveActual).toHaveBeenCalledExactlyOnceWith(planned);
  });

  it('opens the recorded date without a glued-on label and can clear just that date', async () => {
    const user = userEvent.setup();
    const saveActual = vi.fn().mockResolvedValue(undefined);
    render(<InlinePlanDateEditor dates={{ activity: 'transplanting', planned, actual: '2026-07-03' }}
      mode="actual" hasFocus onSaveActual={saveActual} />);
    const action = screen.getByRole('button', { name: transplantLabel });
    expect(action).toHaveTextContent(/^3\.7\.2026$/);
    await user.click(action);
    const editor = screen.getByRole('dialog');
    const field = within(editor).getByLabelText(transplantLabel);
    expect(field).toHaveValue('2026-07-03');
    expect(field).toHaveAccessibleDescription('2 Tage später');
    fireEvent.change(field, { target: { value: '2026-06-30' } });
    expect(field).toHaveAccessibleDescription('1 Tag früher');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(editor).not.toBeInTheDocument());
    expect(saveActual).not.toHaveBeenCalled();
    await user.click(action);
    const reopened = screen.getByRole('dialog');
    expect(within(reopened).getByLabelText(transplantLabel)).toHaveValue('2026-07-03');
    await user.click(within(reopened).getByRole('button', { name: 'Datum löschen' }));
    await user.click(within(reopened).getByRole('button', { name: 'Speichern' }));
    expect(saveActual).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('opens empty when there is no planned or actual date', async () => {
    const user = userEvent.setup();
    render(<InlinePlanDateEditor dates={{ activity: 'harvestEnd', planned: null, actual: null }} mode="actual"
      hasFocus onSaveActual={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Ist-Ernteende' }));
    const editor = within(screen.getByRole('dialog'));
    expect(editor.getByLabelText('Ist-Ernteende')).toHaveValue('');
    expect(editor.queryByText('Plan')).not.toBeInTheDocument();
    expect(editor.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  it('discards the actual date draft when changing display modes', async () => {
    const user = userEvent.setup();
    const saveActual = vi.fn();
    const dates = { activity: 'transplanting', planned, actual: null } as const;
    const dateEditor = (mode: 'actual' | 'combined') => (
      <InlinePlanDateEditor dates={dates} mode={mode} hasFocus onSaveActual={saveActual}
        renderPlanned={(label, actualAction) => <>{actualAction}<input aria-label={label} /></>} />
    );
    const { rerender } = render(dateEditor('actual'));
    await user.click(screen.getByRole('button', { name: transplantLabel }));
    const input = within(screen.getByRole('dialog')).getByLabelText(transplantLabel);
    fireEvent.change(input, { target: { value: '2026-07-05' } });

    rerender(dateEditor('combined'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Plan Pflanztermin' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Terminart wählen · Pflanztermin' }));
    const editor = within(screen.getByRole('dialog'));
    expect(editor.getByRole('button', { name: 'Plan', exact: true })).toBeVisible();
    expect(editor.getByRole('button', { name: 'Ist', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(editor.getByLabelText(transplantLabel)).toHaveValue(planned);
    expect(saveActual).not.toHaveBeenCalled();
  });

  it.each(localizedTransplantLabels)('distinguishes planned and actual labels in %s', async (language, planLabel, actualLabel) => {
    await i18n.changeLanguage(language);
    const user = userEvent.setup();
    const view = render(<InlinePlanDateEditor dates={{ activity: 'transplanting', planned, actual: null }} mode="actual"
      hasFocus onSaveActual={vi.fn()} />);
    try {
      await user.click(screen.getByRole('button', { name: actualLabel }));
      const editor = within(screen.getByRole('dialog', { name: actualLabel }));
      expect(editor.getByText(planLabel, { exact: true })).toBeVisible();
      expect(editor.getByLabelText(actualLabel)).toHaveValue(planned);
    } finally {
      view.unmount();
      await i18n.changeLanguage('de');
    }
  });
});
