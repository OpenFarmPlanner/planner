import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PlantingPlanDetail, Task } from '../api/types';
import { PlantingPlanTasks } from '../planting-plans/PlantingPlanTasks';

const api = vi.hoisted(() => ({ listForPlan: vi.fn(), create: vi.fn(), listMembers: vi.fn() }));
vi.mock('../api/api', () => ({ taskAPI: api, projectAPI: api }));

const plan: PlantingPlanDetail = {
  id: 4, crop: 2, crop_name: 'Kohl', crop_available: true, season: 3,
  bed: 5, bed_name: 'Anzuchtbeet', field_name: 'Nordparzelle', location_name: 'Hof', planting_date: null,
};
const created: Task = {
  id: 10, project: 1, planting_plan: plan.id, season: 3, crop: 2, field: null,
  title: 'Beet kontrollieren', description: '', due_date: null, status: 'pending', assigned_to: null,
  origin: 'manual', calculated_due_date: null, due_date_overridden: false, source_key: '', occurrence_index: 0,
  created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z',
};
const existing = { ...created, id: 9, title: 'Bestand prüfen' };

beforeEach(() => {
  vi.resetAllMocks();
  api.listForPlan.mockResolvedValue({ results: [existing, created] });
  api.create.mockResolvedValue({ data: created });
  api.listMembers.mockResolvedValue({ data: [] });
});

it('adds the saved task once even when the initial read was still pending', async () => {
  let completeInitialRead!: (data: { results: Task[] }) => void;
  const initialRead = new Promise<{ results: Task[] }>(resolve => { completeInitialRead = resolve; });
  api.listForPlan.mockReturnValueOnce(initialRead);
  let completeWrite!: (response: { data: Task }) => void;
  api.create.mockReturnValueOnce(new Promise<{ data: Task }>(resolve => { completeWrite = resolve; }));

  render(<PlantingPlanTasks plan={plan} projectId={1} editableSeasonLabel="Frühjahr" />);
  fireEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }));
  const form = within(screen.getByRole('dialog', { name: 'Aufgabe hinzufügen' }));
  expect(form.getByRole('textbox', { name: 'Anbauplan' })).toHaveValue('Kohl · Anzuchtbeet');
  expect(form.getByRole('textbox', { name: 'Parzelle' })).toHaveValue('Nordparzelle');
  expect(form.getByRole('textbox', { name: 'Saison' })).toHaveValue('Frühjahr');
  fireEvent.change(form.getByRole('textbox', { name: 'Titel' }), { target: { value: ` ${created.title} ` } });
  const save = form.getByRole('button', { name: 'Speichern' });
  const htmlForm = save.closest('form')!;
  act(() => {
    fireEvent.submit(htmlForm);
    fireEvent.submit(htmlForm);
  });
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
    planting_plan: 4, crop: 2, season: 3, field: null, title: created.title,
  }));
  await act(async () => completeWrite({ data: created }));
  expect(await screen.findByText(existing.title)).toBeVisible();
  await act(async () => completeInitialRead({ results: [existing] }));
  expect(screen.getAllByText(created.title)).toHaveLength(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.listForPlan.mock.calls[0][1].aborted).toBe(true);
});

it('retries loading assignees inside the form and preserves the draft', async () => {
  api.listMembers.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
    data: [{ user: 6, user_display_name: 'Projektmitglied' }],
  });
  render(<PlantingPlanTasks plan={plan} projectId={1} editableSeasonLabel="Frühjahr" />);
  fireEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }));
  const form = within(screen.getByRole('dialog', { name: 'Aufgabe hinzufügen' }));
  const title = form.getByRole('textbox', { name: 'Titel' });
  fireEvent.change(title, { target: { value: created.title } });
  expect(await form.findByRole('alert')).toHaveTextContent('Mitglieder konnten nicht geladen werden');
  fireEvent.click(form.getByRole('button', { name: 'Erneut versuchen' }));
  const assignee = form.getByRole('combobox', { name: 'Verantwortlich' });
  await waitFor(() => expect(assignee).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.mouseDown(assignee);
  fireEvent.click(await screen.findByRole('option', { name: 'Projektmitglied' }));
  expect(title).toHaveValue(created.title);
  fireEvent.click(form.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.listMembers).toHaveBeenCalledTimes(2);
  expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ assigned_to: 6 }));
});
