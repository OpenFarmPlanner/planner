import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../pages/Dashboard';
import type { Task } from '../api/types';

const mocks = vi.hoisted(() => ({
  locationList: vi.fn(),
  fieldList: vi.fn(),
  bedList: vi.fn(),
  cropList: vi.fn(),
  planList: vi.fn(),
  taskList: vi.fn(),
  taskUpdate: vi.fn(),
  taskCreate: vi.fn(),
  taskEdit: vi.fn(),
  taskDelete: vi.fn(),
  members: vi.fn(),
}));

const outletState = vi.hoisted(() => ({ activeSeason: { id: 1 } as { id: number } | null }));

const projectRequirementState = vi.hoisted(() => ({
  activeProjectId: 1,
  shouldShowProjectRequiredState: false,
  missingProjectReason: null as null | 'no_projects' | 'no_active_project',
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    taskAPI: { listAll: mocks.taskList, updateStatus: mocks.taskUpdate, create: mocks.taskCreate, update: mocks.taskEdit, delete: mocks.taskDelete },
    projectAPI: { ...actual.projectAPI, listMembers: mocks.members },
    locationAPI: { ...actual.locationAPI, list: mocks.locationList, listAll: async () => (await mocks.locationList()).data },
    fieldAPI: { ...actual.fieldAPI, list: mocks.fieldList, listAll: async () => (await mocks.fieldList()).data },
    bedAPI: { ...actual.bedAPI, list: mocks.bedList, listAll: async () => (await mocks.bedList()).data },
    cropAPI: { ...actual.cropAPI, list: mocks.cropList, listAll: async () => (await mocks.cropList()).data },
    plantingPlanAPI: { ...actual.plantingPlanAPI, list: mocks.planList, listAll: async () => (await mocks.planList()).data },
  };
});

vi.mock('react-router', async () => ({
  ...await vi.importActual<typeof import('react-router')>('react-router'),
  useOutletContext: () => ({ activeSeason: outletState.activeSeason, requestSeasonCreation: vi.fn() }),
}));

vi.mock('../hooks/useProjectRequirement', () => ({ useProjectRequirement: () => projectRequirementState }));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1, project: 1, season: 1, title: 'Jäten', description: '', status: 'pending',
    due_date: '2026-11-05', planting_plan: null, crop: null, assigned_to: null,
    origin: 'manual', calculated_due_date: null, due_date_overridden: false,
    source_key: '', occurrence_index: 0, created_at: '', updated_at: '', ...overrides,
  };
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    outletState.activeSeason = { id: 1 };
    projectRequirementState.shouldShowProjectRequiredState = false;
    projectRequirementState.missingProjectReason = null;
    mocks.locationList.mockResolvedValue({ data: { results: [] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [] } });
    mocks.bedList.mockResolvedValue({ data: { results: [] } });
    mocks.cropList.mockResolvedValue({ data: { results: [] } });
    mocks.planList.mockResolvedValue({ data: { results: [] } });
    mocks.taskList.mockResolvedValue({ results: [] });
    mocks.members.mockResolvedValue({ data: [] });
  });

  it('retries a failed load without showing the onboarding checklist', async () => {
    mocks.taskList.mockRejectedValueOnce(new Error('offline'));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const retry = await screen.findByRole('button', { name: 'Erneut versuchen' });
    expect(screen.queryByText('Projektstart')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Parzelle hinzufügen' })).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText('Projektstart')).toBeInTheDocument();
    await waitFor(() => expect(mocks.taskList).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows unified onboarding checklist for a completely empty project', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText('Projektstart')).toBeInTheDocument();
    expect(screen.getByText('OpenFarmPlanner unterstützt dich bei der strukturierten Planung von Flächen, Kulturen und Anbauzyklen. Beginne mit deiner ersten Parzelle.')).toBeInTheDocument();
    expect(screen.queryByText('Standort hinzufügen')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Parzelle hinzufügen' })).toHaveAttribute('href', '/app/fields-beds?action=add-parcel');
    expect(screen.queryByText('Anstehende Aufgaben')).not.toBeInTheDocument();
  });

  it('keeps the same onboarding card for partially configured projects', async () => {
    mocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof' }] } });

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByText('Projektstart')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Parzelle hinzufügen' })).toHaveAttribute(
      'href',
      '/app/fields-beds?action=add-parcel',
    );
    expect(screen.queryByText('Starte deine Anbauplanung')).not.toBeInTheDocument();
  });

  it('shows the crop library as the primary next action when crops are missing', async () => {
    mocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof' }] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [{ id: 2, name: 'Nord', location: 1 }] } });
    mocks.bedList.mockResolvedValue({ data: { results: [{ id: 3, name: 'Beet A', field: 2 }] } });

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    const libraryLink = await screen.findByRole('link', { name: 'Kulturbibliothek öffnen' });
    const createCropLink = screen.getByRole('link', { name: 'Kultur hinzufügen' });

    expect(libraryLink).toHaveAttribute('href', '/app/crops?library=true');
    expect(libraryLink.className).toContain('MuiButton-contained');
    expect(createCropLink).toHaveAttribute('href', '/app/crops?create=true');
    expect(createCropLink.className).toContain('MuiButton-outlined');
  });

  it('shows persisted tasks and ready state when setup is complete', async () => {
    mocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof' }] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [{ id: 2, name: 'Nord', location: 1 }] } });
    mocks.bedList.mockResolvedValue({ data: { results: [{ id: 3, name: 'Beet A', field: 2 }] } });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 4, name: 'Salat', growth_duration_days: 10 }] } });
    mocks.planList.mockResolvedValue({ data: { results: [{ id: 5, crop: 4, bed: 3, planting_date: '2099-01-01', crop_name: 'Salat' }] } });

    mocks.taskList.mockResolvedValue({ results: [task()] });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByText('Aufgaben-Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Standort hinzufügen')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Parzelle hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByText('Dein Projekt ist eingerichtet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Starte deine Anbauplanung')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Jäten' })).toBeInTheDocument();
    expect(screen.queryByText('Keine anstehenden Aufgaben vorhanden')).not.toBeInTheDocument();
  });

  it('shows compact tasks empty state when setup is complete but there are no upcoming tasks', async () => {
    mocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof' }] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [{ id: 2, name: 'Nord', location: 1 }] } });
    mocks.bedList.mockResolvedValue({ data: { results: [{ id: 3, name: 'Beet A', field: 2 }] } });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 4, name: 'Salat' }] } });
    mocks.planList.mockResolvedValue({ data: { results: [{ id: 5, crop: 4, bed: 3, planting_date: '2020-01-01', crop_name: 'Salat' }] } });

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByText(/Noch keine Aufgaben in dieser Saison/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Offen' })).toBeInTheDocument();
  });

  it('optimistically moves a task via the status menu and rolls back a failed save', async () => {
    mocks.taskList.mockResolvedValue({ results: [task()] });
    let rejectSave: (reason: Error) => void = () => {};
    mocks.taskUpdate.mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject; }));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Status ändern: Jäten' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'In Arbeit' }));
    expect(within(screen.getByRole('region', { name: 'In Arbeit' })).getByRole('article', { name: 'Jäten' })).toHaveAttribute('aria-busy', 'true');
    expect(mocks.taskUpdate).toHaveBeenCalledWith(1, 'in_progress');
    rejectSave(new Error('offline'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Die Änderung wurde zurückgenommen');
    expect(within(screen.getByRole('region', { name: 'Offen' })).getByRole('article', { name: 'Jäten' })).toHaveAttribute('aria-busy', 'false');
  });

  it('persists a successful status change without changing other task data', async () => {
    mocks.taskList.mockResolvedValue({ results: [task()] });
    mocks.taskUpdate.mockResolvedValue({ data: task({ status: 'completed' }) });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Status ändern: Jäten' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Erledigt' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Erledigt' })).getByRole('article', { name: 'Jäten' })).toHaveAttribute('aria-busy', 'false'));
    expect(mocks.taskUpdate).toHaveBeenCalledWith(1, 'completed');
  });

  it('does not show an empty board when loading tasks fails', async () => {
    mocks.taskList.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Aufgaben-Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText(/Noch keine Aufgaben/)).not.toBeInTheDocument();
  });


  it('filters linked tasks through their crop, planting-plan field and assignee', async () => {
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 4, name: 'Salat' }] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [{ id: 3, name: 'Nord' }] } });
    mocks.bedList.mockResolvedValue({ data: { results: [{ id: 2, field: 3 }] } });
    mocks.planList.mockResolvedValue({ data: { results: [{ id: 5, bed: 2 }] } });
    mocks.members.mockResolvedValue({ data: [{ id: 1, user: 7, user_display_name: 'Alex' }] });
    mocks.taskList.mockResolvedValue({ results: [
      task({ planting_plan: 5, crop: 4, assigned_to: 7 }), task({ id: 2, title: 'Andere' }),
    ] });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByRole('article', { name: 'Andere' });
    for (const [label, option] of [['Kultur', 'Salat'], ['Parzelle', 'Nord'], ['Verantwortlich', 'Alex']]) {
      fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
      fireEvent.click(screen.getByRole('option', { name: option }));
      expect(await screen.findByRole('article', { name: 'Jäten' })).toBeInTheDocument();
      expect(screen.queryByRole('article', { name: 'Andere' })).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(await screen.findByRole('article', { name: 'Andere' })).toBeInTheDocument();
  });


  it('creates a task without crop or plan and retains it on the board', async () => {
    mocks.taskCreate.mockResolvedValue({ data: task({ id: 8, title: 'Zaun reparieren', due_date: null }) });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Aufgabe hinzufügen' }));
    const dialog = screen.getByRole('dialog', { name: 'Aufgabe hinzufügen' });
    expect(within(dialog).getByRole('button', { name: 'Speichern' })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Titel' }), { target: { value: 'Zaun reparieren' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('article', { name: 'Zaun reparieren' })).toBeInTheDocument();
    expect(mocks.taskCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Zaun reparieren', crop: null, field: null, planting_plan: null,
      assigned_to: null, due_date: null, season: 1,
    }));
  });

  it('editing a generated task without changing its date leaves the override untouched', async () => {
    const generated = task({ origin: 'automatic', calculated_due_date: '2026-11-05' });
    mocks.taskList.mockResolvedValue({ results: [generated] });
    mocks.taskEdit.mockResolvedValue({ data: { ...generated, description: 'North bed' } });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Status ändern: Jäten' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aufgabe bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Aufgabe bearbeiten' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Beschreibung' }), { target: { value: 'North bed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(mocks.taskEdit).toHaveBeenCalled());
    expect(mocks.taskEdit.mock.calls[0][1]).not.toHaveProperty('due_date');
    expect(mocks.taskEdit.mock.calls[0][1]).not.toHaveProperty('due_date_overridden');
    expect(mocks.taskEdit.mock.calls[0][1]).not.toHaveProperty('origin');
  });

  it('keeps a draft open after a save error', async () => {
    mocks.taskCreate.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Aufgabe hinzufügen' }));
    const dialog = screen.getByRole('dialog', { name: 'Aufgabe hinzufügen' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Titel' }), { target: { value: 'Entwurf' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Die Aufgabe konnte nicht gespeichert werden');
    expect(within(dialog).getByRole('textbox', { name: 'Titel' })).toHaveValue('Entwurf');
  });

  it('deletes only after explicit confirmation and defaults focus to cancel', async () => {
    mocks.taskList.mockResolvedValue({ results: [task()] });
    mocks.taskDelete.mockResolvedValue({});
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Status ändern: Jäten' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aufgabe löschen' }));
    const dialog = await screen.findByRole('dialog');
    expect(mocks.taskDelete).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Jäten' })).not.toBeInTheDocument());
    expect(mocks.taskDelete).toHaveBeenCalledWith(1);
  });


  it('keeps first-project onboarding focused until a season or tasks exist', async () => {
    outletState.activeSeason = null;
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText('Projektstart')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Parzelle hinzufügen' })).toBeInTheDocument();
    expect(screen.queryByText('Aufgaben-Dashboard')).not.toBeInTheDocument();
  });


  it('derives a linked task field from its plan instead of persisting a stale direct assignment', async () => {
    mocks.fieldList.mockResolvedValue({ data: { results: [{ id: 3, name: 'Old field' }, { id: 4, name: 'New field' }] } });
    mocks.bedList.mockResolvedValue({ data: { results: [{ id: 2, field: 4 }] } });
    mocks.planList.mockResolvedValue({ data: { results: [{ id: 5, bed: 2, crop: null }] } });
    const linked = task({ planting_plan: 5, field: 3 });
    mocks.taskList.mockResolvedValue({ results: [linked] });
    mocks.taskEdit.mockResolvedValue({ data: { ...linked, field: null } });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const before = await screen.findByRole('article', { name: 'Jäten' });
    expect(before).toHaveTextContent('New field');
    expect(before).not.toHaveTextContent('Old field');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Parzelle' }));
    fireEvent.click(screen.getByRole('option', { name: 'New field' }));
    expect(await screen.findByRole('article', { name: 'Jäten' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Status ändern: Jäten' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aufgabe bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Aufgabe bearbeiten' });
    expect(within(dialog).getByRole('combobox', { name: 'Parzelle' })).toHaveTextContent('New field');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(mocks.taskEdit).toHaveBeenCalled());
    expect(mocks.taskEdit.mock.calls[0][1]).toMatchObject({ planting_plan: 5, field: null });
    const card = await screen.findByRole('article', { name: 'Jäten' });
    expect(card).toHaveTextContent('New field');
    expect(card).not.toHaveTextContent('Old field');
  });

});
