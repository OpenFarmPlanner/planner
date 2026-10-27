import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../pages/Dashboard';

const mocks = vi.hoisted(() => ({
  locationList: vi.fn(),
  fieldList: vi.fn(),
  bedList: vi.fn(),
  cropList: vi.fn(),
  planList: vi.fn(),
}));

const projectRequirementState = vi.hoisted(() => ({
  shouldShowProjectRequiredState: false,
  missingProjectReason: null as null | 'no_projects' | 'no_active_project',
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    locationAPI: { ...actual.locationAPI, list: mocks.locationList, listAll: async () => (await mocks.locationList()).data },
    fieldAPI: { ...actual.fieldAPI, list: mocks.fieldList, listAll: async () => (await mocks.fieldList()).data },
    bedAPI: { ...actual.bedAPI, list: mocks.bedList, listAll: async () => (await mocks.bedList()).data },
    cropAPI: { ...actual.cropAPI, list: mocks.cropList, listAll: async () => (await mocks.cropList()).data },
    plantingPlanAPI: { ...actual.plantingPlanAPI, list: mocks.planList, listAll: async () => (await mocks.planList()).data },
  };
});

vi.mock('../hooks/useProjectRequirement', () => ({ useProjectRequirement: () => projectRequirementState }));

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectRequirementState.shouldShowProjectRequiredState = false;
    projectRequirementState.missingProjectReason = null;
    mocks.locationList.mockResolvedValue({ data: { results: [] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [] } });
    mocks.bedList.mockResolvedValue({ data: { results: [] } });
    mocks.cropList.mockResolvedValue({ data: { results: [] } });
    mocks.planList.mockResolvedValue({ data: { results: [] } });
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

  it('shows aggregated upcoming tasks and ready state when setup is complete', async () => {
    mocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof' }] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [{ id: 2, name: 'Nord', location: 1 }] } });
    mocks.bedList.mockResolvedValue({ data: { results: [{ id: 3, name: 'Beet A', field: 2 }] } });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 4, name: 'Salat', growth_duration_days: 10 }] } });
    mocks.planList.mockResolvedValue({ data: { results: [{ id: 5, crop: 4, bed: 3, planting_date: '2099-01-01', crop_name: 'Salat' }] } });

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByText('Anstehende Aufgaben')).toBeInTheDocument();
    expect(screen.queryByText('Standort hinzufügen')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Parzelle hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByText('Dein Projekt ist eingerichtet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Starte deine Anbauplanung')).not.toBeInTheDocument();
    expect(screen.getByText('Anstehende Aufgaben')).toBeInTheDocument();
    expect(screen.queryByText('Keine anstehenden Aufgaben vorhanden')).not.toBeInTheDocument();
  });

  it('shows compact tasks empty state when setup is complete but there are no upcoming tasks', async () => {
    mocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof' }] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [{ id: 2, name: 'Nord', location: 1 }] } });
    mocks.bedList.mockResolvedValue({ data: { results: [{ id: 3, name: 'Beet A', field: 2 }] } });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 4, name: 'Salat' }] } });
    mocks.planList.mockResolvedValue({ data: { results: [{ id: 5, crop: 4, bed: 3, planting_date: '2020-01-01', crop_name: 'Salat' }] } });

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByText('Keine anstehenden Aufgaben')).toBeInTheDocument();
    expect(screen.getByText('Aktuell gibt es keine anstehenden Aufgaben für dieses Projekt.')).toBeInTheDocument();
  });
});
