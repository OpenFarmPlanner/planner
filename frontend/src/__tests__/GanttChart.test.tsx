import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/authContextShared';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';
import GanttChartPage from '../pages/GanttChart';
import { getGanttRenderWindow } from '../pages/ganttRenderWindow';
import i18n from '../i18n/config';

const mocks = vi.hoisted(() => ({
  locationList: vi.fn(),
  fieldList: vi.fn(),
  bedList: vi.fn(),
  planList: vi.fn(),
  cropList: vi.fn(),
  planUpdate: vi.fn(),
  planDelete: vi.fn(),
  ganttProps: vi.fn(),
  navigate: vi.fn(),
}));
const topbarContext = vi.hoisted(() => ({
  setTopbarContextActions: vi.fn(),
  setTopbarTitleActions: vi.fn(),
  latestActions: [] as Array<Record<string, unknown>>,
  latestTitleActions: [] as Array<Record<string, unknown>>,
}));
const outletSeasonState = vi.hoisted(() => ({ activeSeasonYear: null as number | null }));
const projectRequirementState = vi.hoisted(() => ({
  shouldShowProjectRequiredState: false,
  missingProjectReason: null as null | 'no_projects' | 'no_active_project',
}));
const OCCUPANCY_MODE_TOOLTIP =
  'Zeigt die Belegung der Beete über das Jahr. Die dargestellten Zeiträume werden aus den Anbauplänen und den kulturspezifischen Zeitangaben (z. B. Aussaat, Pflanzung und Ernte) berechnet.';
const PROPAGATION_MODE_TOOLTIP =
  'Zeigt die Anzuchtphase der Kulturen vor der Pflanzung. Die dargestellten Zeiträume werden aus den Anbauplänen sowie den kulturspezifischen Angaben zur Anzuchtdauer berechnet.';
const TIMELINE_VIEW_MODE_STORAGE_KEY = 'openFarmPlanner.ganttChart.timelineViewMode.42';
const GANTT_STATE_STORAGE_KEY = 'openfarmplanner:gantt:42:state';

const getTodayIsoDate = (): string => new Date().toISOString().slice(0, 10);

interface TestTopbarAction {
  id: string;
  label: string;
  active?: boolean;
  groupId?: string;
  tooltip?: string;
  onClick: () => void;
}

const getTopbarAction = (id: string): TestTopbarAction => {
  const action = topbarContext.latestTitleActions.find((item) => item.id === id) as TestTopbarAction | undefined;
  if (!action) {
    throw new Error(`Missing topbar action: ${id}`);
  }
  return action;
};

const authContextValue: AuthContextValue = {
  user: null,
  isLoading: false,
  activeProjectId: 42,
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  activate: vi.fn(),
  resendActivation: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  requestAccountDeletion: vi.fn(),
  restoreAccount: vi.fn(),
  switchActiveProject: vi.fn(),
  refreshUser: vi.fn(),
};

const renderWithAuth = (): ReturnType<typeof render> => render(
  <MemoryRouter>
    <AuthContext.Provider value={authContextValue}>
      <FocusManagerProvider><CommandProvider>
        <GanttChartPage />
      </CommandProvider></FocusManagerProvider>
    </AuthContext.Provider>
  </MemoryRouter>,
);

const withMobileCalendarViewport = (): (() => void) => {
  const originalMatchMedia = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width:899.95px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  return () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  };
};

// Narrower than withMobileCalendarViewport: matches both the 'md' and 'sm'
// down-queries, like an actual phone-width viewport would, so the
// isPhoneViewport-gated level-toggle buttons can be tested as hidden.
const withPhoneCalendarViewport = (): (() => void) => {
  const originalMatchMedia = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width:899.95px') || query.includes('max-width:599.95px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  return () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  };
};

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    locationAPI: {
      listAll: async () => (await mocks.locationList()).data,
    },
    fieldAPI: {
      listAll: async () => (await mocks.fieldList()).data,
    },
    bedAPI: {
      listAll: async () => (await mocks.bedList()).data,
    },
    plantingPlanAPI: {
      listAll: async () => (await mocks.planList()).data,
      update: mocks.planUpdate,
      delete: mocks.planDelete,
    },
    cropAPI: {
      listAll: async () => (await mocks.cropList()).data,
    },
  };
});

vi.mock('../hooks/useProjectRequirement', () => ({
  useProjectRequirement: () => projectRequirementState,
}));


vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useOutletContext: () => ({
      setTopbarContextActions: (actions: Array<Record<string, unknown>>) => {
        topbarContext.latestActions = actions;
        topbarContext.setTopbarContextActions(actions);
      },
      setTopbarTitleActions: (actions: Array<Record<string, unknown>>) => {
        topbarContext.latestTitleActions = actions;
        topbarContext.setTopbarTitleActions(actions);
      },
      activeSeasonYear: outletSeasonState.activeSeasonYear,
      activeSeason: null,
    }),
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('../gantt-chart/src', () => ({
  __esModule: true,
  default: (props: {
    tasks: Array<{
      id: string;
      name: string;
      tasks: Array<Record<string, unknown> & { id: string; name: string; plantingPlanId?: number }>;
      isExpandable?: boolean;
      isExpanded?: boolean;
      emptyRowLabel?: string;
      rowHeightOverride?: number;
      bedId?: number;
      fieldId?: number;
      locationId?: number;
    }>;
    renderTooltip?: ({ task }: { task: Record<string, unknown> }) => ReactNode;
    onTaskUpdate?: (groupId: string, task: { id: string; startDate: Date }) => void | Promise<void>;
    onToggleGroupExpand?: (groupId: string) => void;
    onTaskDoubleClick?: (task: Record<string, unknown>, group: Record<string, unknown>) => void;
    onTaskContextMenu?: (event: unknown, task: Record<string, unknown>, group: Record<string, unknown>) => void;
    onGroupContextMenu?: (event: unknown, group: Record<string, unknown>) => void;
    editMode?: boolean;
    allowTaskMove?: boolean;
    renderHeader?: (props: {
      title: string;
      darkMode: boolean;
      viewMode: string;
      onViewModeChange: (mode: string) => void;
      showViewModeSelector: boolean;
    }) => ReactNode;
    viewMode?: string;
    leftColumnWidth?: number;
    focusMode?: boolean;
    locale?: string;
    localeText?: { title?: string } & Record<string, unknown>;
    maxHeight?: string | number;
    headerLabel?: ReactNode;
  }) => {
    mocks.ganttProps(props);
    // With the occupancy tree, tasks[0] is often a Standort/Parzelle parent
    // row with no bars of its own — find the first group that actually has
    // tasks (a bed/leaf row), matching what the old flat model always had
    // at index 0.
    const firstGroupWithTasks = props.tasks.find((group) => group.tasks.length > 0);
    const firstTask = firstGroupWithTasks?.tasks[0];
    const firstGroupName = firstGroupWithTasks?.name ?? '';
    return (
      <div data-testid="mock-gantt">
        {props.renderHeader?.({
          title: props.localeText?.title ?? 'Project Timeline',
          darkMode: false,
          viewMode: props.viewMode ?? 'month',
          onViewModeChange: vi.fn(),
          showViewModeSelector: true,
        })}
        <div data-testid="mock-gantt-task-list-header">{props.headerLabel}</div>
        <div
          className="rmg-container"
          data-testid="mock-gantt-scroll-container"
          ref={(node) => {
            if (!node) {
              return;
            }
            Object.defineProperty(node, 'clientWidth', { configurable: true, value: 1000 });
            Object.defineProperty(node, 'scrollWidth', { configurable: true, value: 2000 });
          }}
        />
        {firstTask ? (
          <div
            data-testid="mock-touch-task"
            data-rmg-component="task"
            data-task-id={String(firstTask.id)}
          >
            touch-task
          </div>
        ) : null}
        {firstTask && props.onTaskUpdate ? (
          <button
            type="button"
            data-testid="mock-update-task"
            onClick={() => {
              void props.onTaskUpdate(firstGroupName, {
                id: String(firstTask.id),
                startDate: new Date('2026-04-05'),
              });
            }}
          >
            update-task
          </button>
        ) : null}
        {props.tasks.map((group) => (
        <div key={group.name}>
          <span>{group.name}</span>
          {group.isExpandable ? (
            <button
              type="button"
              aria-label={`toggle-${group.name}`}
              aria-expanded={Boolean(group.isExpanded)}
              onClick={() => props.onToggleGroupExpand?.(group.id)}
            >
              {group.isExpanded ? 'collapse' : 'expand'}
            </button>
          ) : null}
          {/* The real library renders `emptyRowLabel` in the group's timeline
              row, never in the left column — see
              TaskRow.emptyRowLabel.test.tsx. */}
          {group.emptyRowLabel ? (
            <span data-testid={`timeline-summary-${group.name}`}>{group.emptyRowLabel}</span>
          ) : null}
          <span data-testid={`row-height-${group.name}`}>{group.rowHeightOverride ?? 'auto'}</span>
          {props.onGroupContextMenu ? (
            <button
              type="button"
              aria-label={`context-menu-group-${group.name}`}
              onClick={(event) => props.onGroupContextMenu?.(event, group)}
            >
              group-context-menu
            </button>
          ) : null}
          {group.tasks.map((task) => (
            <span key={`${group.name}-${task.name}`}>
              {task.name}
              {props.onTaskDoubleClick ? (
                <button
                  type="button"
                  aria-label={`open-task-${task.id}`}
                  onClick={() => props.onTaskDoubleClick?.(task, group)}
                >
                  open
                </button>
              ) : null}
              {props.onTaskContextMenu ? (
                <button
                  type="button"
                  aria-label={`context-menu-task-${task.id}`}
                  onClick={(event) => props.onTaskContextMenu?.(event, task, group)}
                >
                  task-context-menu
                </button>
              ) : null}
            </span>
          ))}
          {group.tasks[0] && props.renderTooltip ? (
            <div data-testid={`mock-tooltip-${group.name}`}>
              {props.renderTooltip({ task: group.tasks[0] })}
            </div>
          ) : null}
        </div>
        ))}
      </div>
    );
  },
  ViewMode: {
    MINUTE: 'minute',
    HOUR: 'hour',
    DAY: 'day',
    WEEK: 'week',
    MONTH: 'month',
    QUARTER: 'quarter',
    YEAR: 'year',
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  projectRequirementState.shouldShowProjectRequiredState = false;
  projectRequirementState.missingProjectReason = null;

  mocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof' }] } });
  mocks.fieldList.mockResolvedValue({ data: { results: [{ id: 2, name: 'Feld', location: 1 }] } });
  mocks.bedList.mockResolvedValue({ data: { results: [{ id: 3, name: 'Beet 1', field: 2 }] } });
  mocks.planUpdate.mockResolvedValue({ data: {} });
  mocks.planDelete.mockResolvedValue({ data: {} });
  topbarContext.setTopbarContextActions.mockReset();
  topbarContext.setTopbarTitleActions.mockReset();
  topbarContext.latestActions = [];
  topbarContext.latestTitleActions = [];
  outletSeasonState.activeSeasonYear = null;
});

describe('GanttChartPage', () => {
  it('limits Gantt rendering to the visible row window', () => {
    const groups = Array.from({ length: 200 }, (_, index) => ({
      id: `bed-${index + 1}`,
      name: `Bed ${index + 1}`,
      tasks: [{
        id: `task-${index + 1}`,
        name: 'Salat',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2026-05-01'),
      }],
    }));

    const window = getGanttRenderWindow(groups, 0, 720);

    expect(window.groups.length).toBeLessThan(groups.length);
    expect(window.startIndex).toBe(0);
    expect(window.totalHeight).toBeGreaterThan(720);
  });

  it('uses measured row heights for the Gantt render window when provided', () => {
    const groups = [
      { id: 'location-1', name: 'Location', tasks: [], rowHeightOverride: 32 },
      { id: 'field-1', name: 'Field', tasks: [], rowHeightOverride: 32 },
      {
        id: 'bed-1',
        name: 'Bed',
        tasks: [{
          id: 'task-1',
          name: 'Salat',
          startDate: new Date('2026-04-01'),
          endDate: new Date('2026-05-01'),
        }],
      },
    ];

    const window = getGanttRenderWindow(groups, 0, 720, (group) => group.rowHeightOverride ?? 44);

    expect(window.totalHeight).toBe(108);
    expect(window.groups).toHaveLength(3);
  });

  it.each([
    ['small', 5],
    ['medium', 80],
    ['large', 2400],
  ])('keeps the %s dataset window non-empty', (_label, rowCount) => {
    const groups = Array.from({ length: rowCount }, (_, index) => ({
      id: `bed-${index + 1}`,
      name: `Bed ${index + 1}`,
      tasks: [{
        id: `task-${index + 1}`,
        name: 'Salat',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2026-05-01'),
      }],
    }));
    const scrollTop = Math.max(0, rowCount * 72 - 720);

    const window = getGanttRenderWindow(groups, scrollTop, 720);

    expect(window.groups.length).toBeGreaterThan(0);
    expect(window.endIndex).toBeLessThanOrEqual(rowCount);
  });

  it('also bounds a visible Gantt window by timeline item count', () => {
    const createTasks = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${index}`,
      name: 'Salat',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-05-01'),
    }));
    const window = getGanttRenderWindow([
      { id: 'bed-1', name: 'Bed 1', tasks: createTasks('first', 500) },
      { id: 'bed-2', name: 'Bed 2', tasks: createTasks('second', 500) },
    ], 0, 720);

    expect(window.groups).toHaveLength(1);
  });

  it('shows field-specific guidance when no locations exist', async () => {
    mocks.planList.mockResolvedValue({ data: { results: [] } });
    mocks.cropList.mockResolvedValue({ data: { results: [] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [] } });
    mocks.bedList.mockResolvedValue({ data: { results: [] } });
    mocks.locationList.mockResolvedValue({ data: { results: [] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Noch keine Anbauplanung möglich')).toBeInTheDocument());
    expect(screen.getByText('Öffne die Anbauflächen und füge dort eine Parzelle beim passenden Standort hinzu. Danach kannst du Beete, Kulturen und Anbaupläne erfassen.')).toBeInTheDocument();
    expect(screen.queryByText('Parzelle fehlt')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Parzelle hinzufügen' })).toHaveAttribute('href', '/app/fields-beds?action=add-parcel');
    expect(screen.queryByRole('link', { name: 'Standort hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByText('Kultur fehlt')).not.toBeInTheDocument();
    expect(screen.queryByText('Beet fehlt')).not.toBeInTheDocument();
    expect(screen.queryByText('Anbauplan fehlt')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Kultur anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Anbauflächen anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Feldbelegung' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ansicht' })).not.toBeInTheDocument();
    expect(screen.queryByText('Ertragsverteilung')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-gantt')).not.toBeInTheDocument();
  });

  it('shows plan guidance without a redundant missing-plan badge when areas and crops exist', async () => {
    mocks.planList.mockResolvedValue({ data: { results: [] } });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Noch keine Anbaupläne vorhanden')).toBeInTheDocument());
    expect(screen.getByText('Für die vorhandenen Anbauflächen wurden noch keine Anbaupläne erstellt. Lege einen Anbauplan an, um Kulturen und Termine im Anbaukalender darzustellen.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anbauplan hinzufügen' })).toBeInTheDocument();
    expect(screen.queryByText('Anbauplan fehlt')).not.toBeInTheDocument();
    expect(screen.queryByText('Öffne die Anbauflächen und füge dort eine Parzelle beim passenden Standort hinzu. Danach kannst du Beete, Kulturen und Anbaupläne erfassen.')).not.toBeInTheDocument();
  });

  it('shows crop-specific guidance when land hierarchy exists but no crops exist', async () => {
    mocks.planList.mockResolvedValue({ data: { results: [] } });
    mocks.cropList.mockResolvedValue({ data: { results: [] } });
    mocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hofstelle' }] } });
    mocks.fieldList.mockResolvedValue({ data: { results: [{ id: 10, name: 'Nordfeld', location: 1 }] } });
    mocks.bedList.mockResolvedValue({ data: { results: [{ id: 20, name: 'Beet 1', field: 10 }] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Noch keine Kulturen vorhanden')).toBeInTheDocument());
    expect(screen.getByText('Lege jetzt deine erste Kultur an oder importiere eine Kultur aus der Kulturbibliothek. Danach kannst du Anbaupläne erstellen.')).toBeInTheDocument();
    expect(screen.getByText('Kultur fehlt')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kulturbibliothek öffnen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kultur hinzufügen' })).toBeInTheDocument();
    expect(screen.queryByText('Öffne die Anbauflächen und füge dort eine Parzelle beim passenden Standort hinzu. Danach kannst du Beete, Kulturen und Anbaupläne erfassen.')).not.toBeInTheDocument();
  });

  it('shows project-required info instead of a red load error when no project is active', async () => {
    projectRequirementState.shouldShowProjectRequiredState = true;
    projectRequirementState.missingProjectReason = 'no_active_project';

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Es ist aktuell kein Projekt ausgewählt.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projekt auswählen' })).toHaveAttribute('href', '/app/project-selection');
    expect(screen.queryByText('Fehler beim Laden der Daten')).not.toBeInTheDocument();
    expect(mocks.locationList).not.toHaveBeenCalled();
  });

  it('keeps the occupancy view active by default', async () => {
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-01',
            harvest_date: '2026-05-01',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Feldplanung')).toBeInTheDocument());
    expect(screen.queryByText(/Belegung von Parzellen und Beeten im Jahresverlauf/i)).not.toBeInTheDocument();
    await waitFor(() => expect(topbarContext.latestTitleActions).toHaveLength(2));
    expect(getTopbarAction('calendar-view-mode-occupancy')).toMatchObject({
      label: 'Feldbelegung',
      active: true,
      groupId: 'calendar-view-mode',
      tooltip: OCCUPANCY_MODE_TOOLTIP,
    });
    expect(getTopbarAction('calendar-view-mode-seedlings')).toMatchObject({
      label: 'Anzucht',
      active: false,
      groupId: 'calendar-view-mode',
      tooltip: PROPAGATION_MODE_TOOLTIP,
    });
    expect(screen.getByRole('button', { name: 'Zeitraum verschieben' })).toBeInTheDocument();
    expect(screen.getByText('Hof')).toBeInTheDocument();
    expect(screen.getByText('Feld')).toBeInTheDocument();
    expect(screen.getByText('Beet 1')).toBeInTheDocument();
    expect(mocks.ganttProps).toHaveBeenCalled();
    const latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0];
    expect(latestProps?.locale).toBe('de-DE');
    expect(latestProps?.localeText).toMatchObject({
      title: 'Feldplanung',
      resources: 'Flächen',
      today: 'Heute',
    });
    expect(latestProps?.editMode).toBe(false);
    expect(latestProps?.allowTaskMove).toBe(false);
    expect(latestProps?.onTaskUpdate).toBeUndefined();
  });

  it('uses the month timeline by default and ignores legacy standalone timeline storage', async () => {
    window.localStorage.setItem(TIMELINE_VIEW_MODE_STORAGE_KEY, 'day');
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-01',
            harvest_date: '2026-05-01',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    renderWithAuth();

    await waitFor(() => {
      const latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0];
      expect(latestProps?.viewMode).toBe('month');
    });
    expect(screen.getByRole('button', { name: 'Monat' })).toHaveAttribute('aria-pressed', 'true');
  });

  it("defaults the timeline to the active season's start year once it loads", async () => {
    outletSeasonState.activeSeasonYear = 2025;
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 11,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2025-04-01',
            harvest_date: '2025-05-01',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    renderWithAuth();

    await waitFor(() => {
      const latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0] as { startDate?: Date; endDate?: Date } | undefined;
      expect(latestProps?.startDate?.getFullYear()).toBe(2025);
      expect(latestProps?.endDate?.getFullYear()).toBe(2025);
    });
  });

  it('scrolls the first calendar open to the current period instead of the timeline end', async () => {
    // Pin "today" to the middle of the plan's date range: the scroll offset
    // this test asserts on is proportional to how far through the year
    // "today" falls, so leaving it on the real wall-clock date made the test
    // fail as the year progressed.
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-01-10',
            harvest_date: '2026-12-20',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    try {
      renderWithAuth();

      const scrollContainer = await screen.findByTestId('mock-gantt-scroll-container');
      await waitFor(() => {
        expect(scrollContainer.scrollLeft).toBeGreaterThan(0);
        expect(scrollContainer.scrollLeft).toBeLessThan(900);
      });
      expect(mocks.ganttProps.mock.calls.at(-1)?.[0]?.focusMode).toBe(false);
      expect(JSON.parse(window.localStorage.getItem(GANTT_STATE_STORAGE_KEY) ?? '{}')).toMatchObject({
        calendarMode: 'occupancy',
        timelineViewMode: 'month',
        referenceDate: getTodayIsoDate(),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the saved calendar mode, timeline period, and row scroll for the active project', async () => {
    window.localStorage.setItem(GANTT_STATE_STORAGE_KEY, JSON.stringify({
      calendarMode: 'seedlings',
      timelineViewMode: 'week',
      referenceDate: '2026-04-15',
      rowScrollTop: 144,
    }));
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            planting_date: '2026-04-20',
            harvest_date: '2026-05-20',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({
      data: {
        results: [{
          id: 5,
          name: 'Salat',
          propagation_days: 28,
        }],
      },
    });

    renderWithAuth();

    const scrollContainer = await screen.findByTestId('mock-gantt-scroll-container');
    const virtualViewport = await screen.findByTestId('gantt-virtual-viewport');
    await waitFor(() => {
      expect(mocks.ganttProps.mock.calls.at(-1)?.[0]?.viewMode).toBe('week');
      expect(scrollContainer.scrollLeft).toBeGreaterThan(700);
      expect(scrollContainer.scrollLeft).toBeLessThan(900);
      expect(virtualViewport.scrollTop).toBe(144);
    });
    await waitFor(() => expect(topbarContext.latestTitleActions).toHaveLength(2));
    expect(getTopbarAction('calendar-view-mode-seedlings')).toMatchObject({
      active: true,
    });
  });

  it('keeps the current row scroll position when switching calendar modes mid-session', async () => {
    // Regression test: the restore effect used to reapply the `rowScrollTop` value
    // captured once at mount (via a memoized read of localStorage) whenever
    // calendarMode changed, snapping the view back to whatever was stored before
    // the user started scrolling in this session — typically the top.
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-20',
            harvest_date: '2026-05-20',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    renderWithAuth();

    const virtualViewport = await screen.findByTestId('gantt-virtual-viewport');
    await waitFor(() => expect(topbarContext.latestTitleActions).toHaveLength(2));

    fireEvent.scroll(virtualViewport, { target: { scrollTop: 300 } });
    await waitFor(() => expect(virtualViewport.scrollTop).toBe(300));

    act(() => {
      getTopbarAction('calendar-view-mode-seedlings').onClick();
    });

    await waitFor(() => {
      expect(getTopbarAction('calendar-view-mode-seedlings')).toMatchObject({ active: true });
    });
    expect(virtualViewport.scrollTop).toBe(300);
  });

  it('resizes the desktop Gantt sidebar and stores the selected width', async () => {
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-01',
            harvest_date: '2026-05-01',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    renderWithAuth();

    const resizeHandle = await screen.findByRole('separator', {
      name: 'Seitenleiste verbreitern oder verkleinern',
    });
    await waitFor(() => {
      expect(mocks.ganttProps.mock.calls.at(-1)?.[0]?.leftColumnWidth).toBe(240);
    });

    fireEvent.pointerDown(resizeHandle, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 310, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    await waitFor(() => {
      expect(mocks.ganttProps.mock.calls.at(-1)?.[0]?.leftColumnWidth).toBe(310);
    });
    expect(JSON.parse(window.localStorage.getItem(GANTT_STATE_STORAGE_KEY) ?? '{}')).toMatchObject({
      leftColumnWidthDesktop: 310,
    });
  });

  it('restores the stored desktop Gantt sidebar width', async () => {
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-01',
            harvest_date: '2026-05-01',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });
    window.localStorage.setItem(GANTT_STATE_STORAGE_KEY, JSON.stringify({
      leftColumnWidth: 360,
    }));

    renderWithAuth();

    const resizeHandle = await screen.findByRole('separator', {
      name: 'Seitenleiste verbreitern oder verkleinern',
    });
    await waitFor(() => {
      expect(mocks.ganttProps.mock.calls.at(-1)?.[0]?.leftColumnWidth).toBe(360);
    });
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '360');
  });

  it('resizes the mobile Gantt sidebar separately from the desktop width', async () => {
    const restoreViewport = withMobileCalendarViewport();
    try {
      window.localStorage.setItem(GANTT_STATE_STORAGE_KEY, JSON.stringify({
        leftColumnWidthDesktop: 360,
      }));

      renderWithAuth();

      const resizeHandle = await screen.findByRole('separator', {
        name: 'Seitenleiste verbreitern oder verkleinern',
      });
      await waitFor(() => {
        expect(mocks.ganttProps.mock.calls.at(-1)?.[0]?.leftColumnWidth).toBe(132);
      });

      fireEvent.pointerDown(resizeHandle, { clientX: 132, pointerId: 2, pointerType: 'touch' });
      fireEvent.pointerMove(window, { clientX: 104, pointerId: 2, pointerType: 'touch' });
      fireEvent.pointerUp(window, { pointerId: 2, pointerType: 'touch' });

      await waitFor(() => {
        expect(mocks.ganttProps.mock.calls.at(-1)?.[0]?.leftColumnWidth).toBe(104);
      });
      expect(JSON.parse(window.localStorage.getItem(GANTT_STATE_STORAGE_KEY) ?? '{}')).toMatchObject({
        leftColumnWidthDesktop: 360,
        leftColumnWidthMobile: 104,
      });
    } finally {
      restoreViewport();
    }
  });

  it('uses page scrolling instead of the virtualized Gantt viewport on mobile', async () => {
    const restoreViewport = withMobileCalendarViewport();
    try {
      window.localStorage.setItem(GANTT_STATE_STORAGE_KEY, JSON.stringify({
        rowScrollTop: 144,
      }));

      renderWithAuth();

      const virtualViewport = await screen.findByTestId('gantt-virtual-viewport');
      await waitFor(() => {
        expect(mocks.ganttProps.mock.calls.at(-1)?.[0]?.leftColumnWidth).toBe(132);
      });
      expect(virtualViewport.scrollTop).toBe(0);
    } finally {
      restoreViewport();
    }
  });

  it('renders the chart flush with the top of the viewport when a stale row-scroll offset exceeds the actual scrollable range', async () => {
    // Simulates a real browser: the stored offset (e.g. saved while a different
    // calendar mode/project had many more rows) exceeds what's actually
    // scrollable here, so the browser clamps any scrollTop assignment to
    // maxScrollTop. jsdom has no layout engine and doesn't clamp on its own, so
    // this stubs Element.prototype.scrollTop to reproduce that clamping.
    const scrollTopValues = new WeakMap<Element, number>();
    const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) {
        return scrollTopValues.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        scrollTopValues.set(this, Math.min(value, 40));
      },
    });

    try {
      window.localStorage.setItem(GANTT_STATE_STORAGE_KEY, JSON.stringify({
        calendarMode: 'seedlings',
        timelineViewMode: 'week',
        referenceDate: '2026-04-15',
        rowScrollTop: 5000,
      }));
      mocks.planList.mockResolvedValue({
        data: {
          results: [
            {
              id: 10,
              crop: 5,
              crop_name: 'Salat',
              planting_date: '2026-04-20',
              harvest_date: '2026-05-20',
            },
          ],
        },
      });
      mocks.cropList.mockResolvedValue({
        data: {
          results: [{
            id: 5,
            name: 'Salat',
            propagation_days: 28,
          }],
        },
      });

      renderWithAuth();

      const virtualViewport = await screen.findByTestId('gantt-virtual-viewport');
      const chart = await screen.findByTestId('mock-gantt');
      await waitFor(() => {
        expect(virtualViewport.scrollTop).toBe(40);
        expect(getComputedStyle(chart.parentElement as HTMLElement).position).not.toBe('absolute');
        expect((chart.parentElement as HTMLElement).style.top).toBe('');
      });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Element.prototype, 'scrollTop', originalDescriptor);
      }
    }
  });

  it('lets short calendars size to content instead of forcing viewport-height whitespace', async () => {
    mocks.planList.mockResolvedValue({
      data: {
        results: [{
          id: 10,
          crop: 5,
          crop_name: 'Salat',
          bed: 3,
          planting_date: '2026-04-01',
          harvest_date: '2026-05-01',
        }],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    renderWithAuth();

    const virtualViewport = await screen.findByTestId('gantt-virtual-viewport');
    await waitFor(() => expect(screen.getByTestId('mock-gantt')).toBeInTheDocument());

    expect(virtualViewport).not.toHaveStyle({ height: 'calc(100vh - 220px)' });
    expect(virtualViewport).not.toHaveStyle({ minHeight: '420px' });
  });

  it('persists timeline view mode changes and keeps them during data updates', async () => {
    const initialPlan = {
      id: 10,
      crop: 5,
      crop_name: 'Salat',
      bed: 3,
      planting_date: '2026-04-01',
      harvest_date: '2026-05-01',
    };
    mocks.planList.mockResolvedValue({ data: { results: [initialPlan] } });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });
    mocks.planUpdate.mockResolvedValue({
      data: {
        ...initialPlan,
        planting_date: '2026-04-05',
      },
    });

    renderWithAuth();

    await screen.findByText('Beet 1');
    fireEvent.click(screen.getByRole('button', { name: 'Woche' }));

    await waitFor(() => {
      const latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0];
      expect(latestProps?.viewMode).toBe('week');
    });
    expect(window.localStorage.getItem(TIMELINE_VIEW_MODE_STORAGE_KEY)).toBe('week');

    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum verschieben' }));
    await screen.findByTestId('mock-update-task');
    fireEvent.click(screen.getByTestId('mock-update-task'));

    await waitFor(() => expect(mocks.planUpdate).toHaveBeenCalledTimes(1));
    const latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0];
    expect(latestProps?.viewMode).toBe('week');
  });

  it('refreshes calendar data on focus without resetting the timeline view mode', async () => {
    const initialPlan = {
      id: 10,
      crop: 5,
      crop_name: 'Salat',
      bed: 3,
      planting_date: '2026-04-01',
      harvest_date: '2026-05-01',
      harvest_end_date: '2026-05-05',
    };
    const refreshedPlan = {
      ...initialPlan,
      harvest_date: '2026-05-10',
      harvest_end_date: '2026-05-20',
    };
    mocks.planList
      .mockResolvedValueOnce({ data: { results: [initialPlan] } })
      .mockResolvedValue({ data: { results: [refreshedPlan] } });
    mocks.cropList.mockResolvedValue({
      data: {
        results: [{
          id: 5,
          name: 'Salat',
          growth_duration_days: 39,
          harvest_duration_days: 10,
        }],
      },
    });

    renderWithAuth();

    await screen.findByText('Beet 1');
    fireEvent.click(screen.getByRole('button', { name: 'Woche' }));
    await waitFor(() => {
      expect(mocks.ganttProps.mock.calls.at(-1)?.[0]?.viewMode).toBe('week');
    });

    fireEvent.focus(window);

    await waitFor(() => expect(mocks.planList).toHaveBeenCalledTimes(2));
    const latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0];
    expect(latestProps?.viewMode).toBe('week');
    const bedGroup = latestProps?.tasks.find((group: { tasks: unknown[] }) => group.tasks.length > 0);
    expect(bedGroup?.tasks[0]?.endDate).toEqual(new Date('2026-05-10T00:00:00.000Z'));
    expect(bedGroup?.tasks[1]?.endDate).toEqual(new Date('2026-05-20T00:00:00.000Z'));
  });

  it('keeps large projects renderable by windowing rows passed to the Gantt library', async () => {
    const rowCount = 200;
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    mocks.bedList.mockResolvedValue({
      data: {
        results: Array.from({ length: rowCount }, (_, index) => ({
          id: index + 1,
          name: `Beet ${index + 1}`,
          field: 2,
        })),
      },
    });
    mocks.planList.mockResolvedValue({
      data: {
        results: Array.from({ length: rowCount }, (_, index) => ({
          id: index + 1,
          crop: 5,
          crop_name: 'Salat',
          bed: index + 1,
          planting_date: '2026-04-01',
          harvest_date: '2026-05-01',
        })),
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('gantt-virtual-viewport')).toBeInTheDocument();
    // The field starts collapsed by default (200+ beds exceeds the
    // auto-expand-all threshold): only the location + field parent rows are
    // visible until it's expanded.
    await waitFor(() => {
      expect(debugSpy).toHaveBeenCalledWith('[Gantt diagnostics]', expect.objectContaining({
        beds: rowCount,
        plantingPlans: rowCount,
        totalRows: 2,
        totalTimelineItems: rowCount,
      }));
    });
    let latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0];
    expect(latestProps?.tasks.length).toBeGreaterThan(0);
    expect(latestProps?.tasks.length).toBeLessThan(rowCount);

    // Expand it to reveal all 200 bed rows and actually exercise scroll
    // windowing across them.
    fireEvent.click(screen.getByRole('button', { name: 'toggle-Feld' }));
    await screen.findByText('Beet 1');
    await waitFor(() => {
      expect(debugSpy).toHaveBeenCalledWith('[Gantt diagnostics]', expect.objectContaining({
        beds: rowCount,
        plantingPlans: rowCount,
        // +2 for the single location + field parent rows in the occupancy tree
        totalRows: rowCount + 2,
        totalTimelineItems: rowCount,
      }));
    });

    fireEvent.scroll(screen.getByTestId('gantt-virtual-viewport'), {
      target: { scrollTop: 7200 },
    });

    await waitFor(() => {
      latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0];
      expect(latestProps?.tasks[0]?.id).not.toBe('bed-1');
    });
    debugSpy.mockRestore();
  });

  it('switches to the seedling view and shows the seedling rows', async () => {
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 11,
            crop: 6,
            crop_name: 'Tomate',
            bed: 3,
            planting_date: '2026-05-10',
            cultivation_type: 'pre_cultivation',
            area_usage_sqm: 8,
            plants_count: 24,
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({
      data: {
        results: [
          {
            id: 6,
            name: 'Tomate',
            propagation_duration_days: 21,
            cultivation_type: 'pre_cultivation',
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(topbarContext.latestTitleActions).toHaveLength(2));
    act(() => {
      getTopbarAction('calendar-view-mode-seedlings').onClick();
    });

    await waitFor(() => expect(screen.getAllByText('Tomate').length).toBeGreaterThan(0));
    expect(screen.queryByText('Standort: Hof / Feld')).not.toBeInTheDocument();
    expect(screen.queryByText('Beet: Beet 1')).not.toBeInTheDocument();
    expect(screen.getByText('Anzuchtbeginn: 19.4.2026')).toBeInTheDocument();
    expect(screen.getByText('Auspflanzung: 10.5.2026')).toBeInTheDocument();
    expect(screen.getByText('Anzuchtdauer: 21 Tage')).toBeInTheDocument();
    expect(screen.queryByText('Fläche: 8,00 m²')).not.toBeInTheDocument();
    expect(screen.getByText('Pflanzen gesamt: 24')).toBeInTheDocument();
    expect(screen.getByText('Anzahl Anbaupläne: 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zeitraum verschieben' })).not.toBeInTheDocument();
    const latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0];
    expect(latestProps?.localeText).toMatchObject({
      title: 'Anzuchtplanung',
      resources: 'Kulturen',
      today: 'Heute',
    });
  });

  it('filters the seedling view by crop name using its own search field, without any hierarchy filters', async () => {
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 11,
            crop: 6,
            crop_name: 'Tomate',
            bed: 3,
            planting_date: '2026-05-10',
            cultivation_type: 'pre_cultivation',
          },
          {
            id: 12,
            crop: 7,
            crop_name: 'Karotte',
            bed: 4,
            planting_date: '2026-05-15',
            cultivation_type: 'pre_cultivation',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({
      data: {
        results: [
          { id: 6, name: 'Tomate', propagation_duration_days: 21, cultivation_type: 'pre_cultivation' },
          { id: 7, name: 'Karotte', propagation_duration_days: 14, cultivation_type: 'pre_cultivation' },
        ],
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(topbarContext.latestTitleActions).toHaveLength(2));
    act(() => {
      getTopbarAction('calendar-view-mode-seedlings').onClick();
    });

    await waitFor(() => expect(screen.getAllByText('Tomate').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Karotte').length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText('Suche nach Kultur, Beet, Parzelle oder Standort…')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Alle Standorte')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Suche nach Kultur…'), {
      target: { value: 'Karotte' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('Karotte').length).toBeGreaterThan(0);
      expect(screen.queryByText('Tomate')).not.toBeInTheDocument();
    });
  });

  it('focuses the active search field with /', async () => {
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-01',
            harvest_date: '2026-05-01',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    const searchField = await screen.findByPlaceholderText('Suche nach Kultur, Beet, Parzelle oder Standort…');
    expect(searchField).not.toHaveFocus();

    fireEvent.keyDown(window, { key: '/' });

    await waitFor(() => expect(searchField).toHaveFocus());
  });

  it('toggles occupancy edit mode with Alt+E', async () => {
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-01',
            harvest_date: '2026-05-01',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Zeitraum verschieben' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(window, { key: 'e', altKey: true });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zeitraum verschieben' })).toHaveAttribute('aria-pressed', 'true');
    });
    const latestProps = mocks.ganttProps.mock.calls.at(-1)?.[0];
    expect(latestProps?.editMode).toBe(true);
    expect(latestProps?.allowTaskMove).toBe(true);
  });

  it('bridges mobile touch drags to the Gantt mouse drag handlers in move mode', async () => {
    const mouseEvents: string[] = [];
    const trackMouseEvent = (event: MouseEvent): void => {
      mouseEvents.push(`${event.type}:${event.clientX}`);
    };
    document.addEventListener('mousedown', trackMouseEvent);
    document.addEventListener('mousemove', trackMouseEvent);
    document.addEventListener('mouseup', trackMouseEvent);

    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-01',
            harvest_date: '2026-05-01',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Zeitraum verschieben' });
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum verschieben' }));
    const task = await screen.findByTestId('mock-touch-task');

    fireEvent.touchStart(task, {
      touches: [{ identifier: 1, clientX: 100, clientY: 120, screenX: 100, screenY: 120 }],
      changedTouches: [{ identifier: 1, clientX: 100, clientY: 120, screenX: 100, screenY: 120 }],
    });
    fireEvent.touchMove(task, {
      touches: [{ identifier: 1, clientX: 140, clientY: 120, screenX: 140, screenY: 120 }],
      changedTouches: [{ identifier: 1, clientX: 140, clientY: 120, screenX: 140, screenY: 120 }],
    });
    fireEvent.touchEnd(task, {
      touches: [],
      changedTouches: [{ identifier: 1, clientX: 140, clientY: 120, screenX: 140, screenY: 120 }],
    });

    await waitFor(() => {
      expect(mouseEvents).toEqual(['mousedown:100', 'mousemove:140', 'mouseup:140']);
    });
    document.removeEventListener('mousedown', trackMouseEvent);
    document.removeEventListener('mousemove', trackMouseEvent);
    document.removeEventListener('mouseup', trackMouseEvent);
  });

  it('still shows a red load error for real API failures', async () => {
    mocks.locationList.mockRejectedValueOnce(new Error('network failed'));

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Fehler beim Laden der Daten')).toBeInTheDocument();
  });

  it('registers helpful mode tooltips for the topbar mode actions', async () => {
    mocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-01',
            harvest_date: '2026-05-01',
          },
        ],
      },
    });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Zeitraum verschieben' })).toBeInTheDocument();

    await waitFor(() => expect(topbarContext.latestTitleActions).toHaveLength(2));
    expect(getTopbarAction('calendar-view-mode-occupancy').tooltip).toBe(OCCUPANCY_MODE_TOOLTIP);
    expect(getTopbarAction('calendar-view-mode-seedlings').tooltip).toBe(PROPAGATION_MODE_TOOLTIP);
  });

  it('shows backend validation errors and reloads plans after failed task update', async () => {
    const initialPlan = {
      id: 10,
      crop: 5,
      crop_name: 'Salat',
      bed: 3,
      planting_date: '2026-04-01',
      harvest_date: '2026-05-01',
    };
    const reloadedPlan = {
      ...initialPlan,
      planting_date: '2026-04-01',
    };
    mocks.planList
      .mockResolvedValueOnce({ data: { results: [initialPlan] } })
      .mockResolvedValueOnce({ data: { results: [reloadedPlan] } });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });
    mocks.planUpdate.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          area_usage_sqm: ['Die Fläche dieses Beets wird im überlappenden Zeitraum überschritten.'],
        },
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    await screen.findByText('Beet 1');
    expect(screen.queryByTestId('mock-update-task')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum verschieben' }));
    await screen.findByTestId('mock-update-task');
    fireEvent.click(screen.getByTestId('mock-update-task'));

    expect(await screen.findByText('Fläche (m²): Die Fläche dieses Beets wird im überlappenden Zeitraum überschritten.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.planList).toHaveBeenCalledTimes(2));
  });

  it('keeps successful task updates working', async () => {
    const initialPlan = {
      id: 10,
      crop: 5,
      crop_name: 'Salat',
      bed: 3,
      planting_date: '2026-04-01',
      harvest_date: '2026-05-01',
    };
    mocks.planList.mockResolvedValue({ data: { results: [initialPlan] } });
    mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });
    mocks.planUpdate.mockResolvedValue({
      data: {
        ...initialPlan,
        planting_date: '2026-04-05',
      },
    });

    render(
      <MemoryRouter>
        <FocusManagerProvider><CommandProvider>
          <GanttChartPage />
        </CommandProvider></FocusManagerProvider>
      </MemoryRouter>,
    );

    await screen.findByText('Beet 1');
    expect(screen.queryByTestId('mock-update-task')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum verschieben' }));
    await screen.findByTestId('mock-update-task');
    fireEvent.click(screen.getByTestId('mock-update-task'));

    await waitFor(() => expect(mocks.planUpdate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Fehler beim Aktualisieren des Anbauplans')).not.toBeInTheDocument();
  });

  describe('occupancy tree filters and search', () => {
    const setUpMultiLocationFixture = () => {
      mocks.locationList.mockResolvedValue({
        data: { results: [{ id: 1, name: 'Hof' }, { id: 2, name: 'Pacht' }] },
      });
      mocks.fieldList.mockResolvedValue({
        data: {
          results: [
            { id: 10, name: 'Nordfeld', location: 1 },
            { id: 20, name: 'Südfeld', location: 2 },
          ],
        },
      });
      mocks.bedList.mockResolvedValue({
        data: {
          results: [
            { id: 100, name: 'Karottenbeet', field: 10 },
            { id: 101, name: 'Leerbeet', field: 10 },
            { id: 200, name: 'Tomatenbeet', field: 20 },
          ],
        },
      });
      mocks.planList.mockResolvedValue({
        data: {
          results: [
            {
              id: 1,
              crop: 1,
              crop_name: 'Karotte',
              bed: 100,
              planting_date: '2026-03-01',
              harvest_date: '2026-05-01',
            },
            {
              id: 2,
              crop: 2,
              crop_name: 'Tomate',
              bed: 200,
              planting_date: '2026-04-01',
              harvest_date: '2026-07-01',
            },
          ],
        },
      });
      mocks.cropList.mockResolvedValue({
        data: { results: [{ id: 1, name: 'Karotte' }, { id: 2, name: 'Tomate' }] },
      });
    };

    describe('structure summary in the timeline area', () => {
      it('shows Parzellen/Beete/belegt for a Standort and Beete/belegt for a Parzelle', async () => {
        setUpMultiLocationFixture();
        renderWithAuth();

        await screen.findByText('Karottenbeet');

        expect(screen.getByTestId('timeline-summary-Hof')).toHaveTextContent('1 Parzelle · 1 Beet · 1 belegt');
        expect(screen.getByTestId('timeline-summary-Nordfeld')).toHaveTextContent('1 Beet · 1 belegt');
      });

      it('hands the summary to the timeline row, not to the left column', async () => {
        setUpMultiLocationFixture();
        renderWithAuth();

        await screen.findByText('Karottenbeet');

        const groups = mocks.ganttProps.mock.calls.at(-1)?.[0]?.tasks as Array<
          Record<string, unknown> & { name: string }
        >;
        const location = groups.find((group) => group.name === 'Hof');
        expect(location?.emptyRowLabel).toBe('1 Parzelle · 1 Beet · 1 belegt');
        // A second, sidebar-rendered copy of the same string would show the
        // summary twice — the left column must only get the row name.
        expect(location).not.toHaveProperty('metaLabel');
      });

      it('uses plural forms once a Standort holds more than one Parzelle and Beet', async () => {
        setUpMultiLocationFixture();
        renderWithAuth();

        await screen.findByText('Karottenbeet');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Nur belegte Beete' }));

        await waitFor(() => {
          expect(screen.getByTestId('timeline-summary-Hof')).toHaveTextContent('1 Parzelle · 2 Beete · 1 belegt');
        });
        expect(screen.getByTestId('timeline-summary-Nordfeld')).toHaveTextContent('2 Beete · 1 belegt');
      });

      it('does not put a summary on Beet rows', async () => {
        setUpMultiLocationFixture();
        renderWithAuth();

        await screen.findByText('Karottenbeet');

        expect(screen.queryByTestId('timeline-summary-Karottenbeet')).not.toBeInTheDocument();
      });

      it('counts the empty Beet only once "Nur belegte Beete" is switched off', async () => {
        setUpMultiLocationFixture();
        renderWithAuth();

        await screen.findByText('Karottenbeet');
        // Filtered view: the pruned Leerbeet must not be counted, otherwise the
        // Standort would claim two Beete above a single visible Beet row.
        expect(screen.getByTestId('timeline-summary-Hof')).toHaveTextContent('1 Parzelle · 1 Beet · 1 belegt');

        fireEvent.click(screen.getByRole('checkbox', { name: 'Nur belegte Beete' }));

        await waitFor(() => {
          expect(screen.getByTestId('timeline-summary-Hof')).toHaveTextContent('1 Parzelle · 2 Beete · 1 belegt');
        });
        expect(screen.getByTestId('timeline-summary-Nordfeld')).toHaveTextContent('2 Beete · 1 belegt');
      });

      it('narrows the counts to the beds a search actually matches', async () => {
        setUpMultiLocationFixture();
        renderWithAuth();

        await screen.findByText('Karottenbeet');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Nur belegte Beete' }));
        await screen.findByText('Leerbeet');
        expect(screen.getByTestId('timeline-summary-Nordfeld')).toHaveTextContent('2 Beete · 1 belegt');

        fireEvent.change(screen.getByPlaceholderText('Suche nach Kultur, Beet, Parzelle oder Standort…'), {
          target: { value: 'Karottenbeet' },
        });

        await waitFor(() => {
          expect(screen.getByTestId('timeline-summary-Nordfeld')).toHaveTextContent('1 Beet · 1 belegt');
        });
        expect(screen.getByTestId('timeline-summary-Hof')).toHaveTextContent('1 Parzelle · 1 Beet · 1 belegt');
      });

      it('keeps the counts stable when a level is collapsed', async () => {
        setUpMultiLocationFixture();
        renderWithAuth();

        await screen.findByText('Karottenbeet');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Nur belegte Beete' }));
        await screen.findByText('Leerbeet');

        fireEvent.click(screen.getByRole('button', { name: 'Eine Hierarchieebene ausblenden' }));

        await waitFor(() => {
          expect(screen.queryByText('Karottenbeet')).not.toBeInTheDocument();
        });
        // Collapsing hides rows; it does not remove beds from the structure.
        expect(screen.getByTestId('timeline-summary-Hof')).toHaveTextContent('1 Parzelle · 2 Beete · 1 belegt');
        expect(screen.getByTestId('timeline-summary-Nordfeld')).toHaveTextContent('2 Beete · 1 belegt');
      });

      it('restricts the counts to the selected Standort', async () => {
        setUpMultiLocationFixture();
        renderWithAuth();

        await screen.findByText('Karottenbeet');

        fireEvent.mouseDown(screen.getByText('Alle Standorte'));
        fireEvent.click(await screen.findByRole('option', { name: 'Pacht' }));

        await waitFor(() => {
          expect(screen.getByTestId('timeline-summary-Pacht')).toHaveTextContent('1 Parzelle · 1 Beet · 1 belegt');
        });
        expect(screen.queryByTestId('timeline-summary-Hof')).not.toBeInTheDocument();
      });

      it('localizes the summary in English', async () => {
        await i18n.changeLanguage('en');
        try {
          setUpMultiLocationFixture();
          renderWithAuth();

          await screen.findByText('Karottenbeet');

          expect(screen.getByTestId('timeline-summary-Hof')).toHaveTextContent('1 field · 1 bed · 1 occupied');
          expect(screen.getByTestId('timeline-summary-Nordfeld')).toHaveTextContent('1 bed · 1 occupied');
        } finally {
          await i18n.changeLanguage('de');
        }
      });
    });

    it('search finds a matching bed and keeps its parent Standort/Parzelle visible while hiding unrelated branches', async () => {
      setUpMultiLocationFixture();
      renderWithAuth();

      await screen.findByText('Karottenbeet');
      expect(screen.getByText('Tomatenbeet')).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText('Suche nach Kultur, Beet, Parzelle oder Standort…'), {
        target: { value: 'Karotte' },
      });

      await waitFor(() => {
        expect(screen.getByText('Hof')).toBeInTheDocument();
        expect(screen.getByText('Nordfeld')).toBeInTheDocument();
        expect(screen.getByText('Karottenbeet')).toBeInTheDocument();
        expect(screen.queryByText('Pacht')).not.toBeInTheDocument();
        expect(screen.queryByText('Südfeld')).not.toBeInTheDocument();
        expect(screen.queryByText('Tomatenbeet')).not.toBeInTheDocument();
      });
    });

    it('Standort filter reduces the visible tree to the selected location', async () => {
      setUpMultiLocationFixture();
      renderWithAuth();

      await screen.findByText('Karottenbeet');

      fireEvent.mouseDown(screen.getByText('Alle Standorte'));
      fireEvent.click(await screen.findByRole('option', { name: 'Pacht' }));

      await waitFor(() => {
        const tree = within(screen.getByTestId('mock-gantt'));
        expect(tree.getByText('Pacht')).toBeInTheDocument();
        expect(tree.getByText('Südfeld')).toBeInTheDocument();
        expect(tree.getByText('Tomatenbeet')).toBeInTheDocument();
        expect(tree.queryByText('Hof')).not.toBeInTheDocument();
        expect(tree.queryByText('Nordfeld')).not.toBeInTheDocument();
        expect(tree.queryByText('Karottenbeet')).not.toBeInTheDocument();
      });
    });

    it('"Nur belegte Beete" hides beds without a planting plan by default and shows them when unchecked', async () => {
      setUpMultiLocationFixture();
      renderWithAuth();

      await screen.findByText('Karottenbeet');
      expect(screen.queryByText('Leerbeet')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Nur belegte Beete' }));

      await waitFor(() => {
        expect(screen.getByText('Leerbeet')).toBeInTheDocument();
      });
    });

    it('the expand/collapse-one-level toggle steps through the tree levels', async () => {
      setUpMultiLocationFixture();
      renderWithAuth();

      await screen.findByText('Karottenbeet');
      // "Nur belegte Beete" forces the ancestor chain of every occupied bed to stay
      // visible regardless of collapse state (same as an active search match) — turn
      // it off so the level toggle's own effect is observable in isolation.
      fireEvent.click(screen.getByRole('checkbox', { name: 'Nur belegte Beete' }));
      await screen.findByText('Leerbeet');

      const expandButton = () => screen.getByRole('button', { name: 'Eine Hierarchieebene mehr anzeigen' });
      const collapseButton = () => screen.getByRole('button', { name: 'Eine Hierarchieebene ausblenden' });

      // Small fixtures auto-expand fully on first load, so Beet rows start visible
      // and the expand button starts disabled.
      expect(expandButton()).toBeDisabled();

      // Collapse once: Beet rows hide, Parzelle rows stay visible.
      fireEvent.click(collapseButton());
      await waitFor(() => {
        expect(screen.getByText('Nordfeld')).toBeInTheDocument();
        expect(screen.queryByText('Karottenbeet')).not.toBeInTheDocument();
      });

      // Collapse again: only Standort rows remain, and collapsing further is disabled.
      fireEvent.click(collapseButton());
      await waitFor(() => {
        expect(screen.getByText('Hof')).toBeInTheDocument();
        expect(screen.queryByText('Nordfeld')).not.toBeInTheDocument();
      });
      expect(collapseButton()).toBeDisabled();

      // Expand once: Parzelle rows reappear, Beet rows stay hidden.
      fireEvent.click(expandButton());
      await waitFor(() => {
        expect(screen.getByText('Nordfeld')).toBeInTheDocument();
        expect(screen.queryByText('Karottenbeet')).not.toBeInTheDocument();
      });

      // Expand again: fully expanded, Beet rows visible and expanding further is disabled.
      fireEvent.click(expandButton());
      await waitFor(() => {
        expect(screen.getByText('Karottenbeet')).toBeInTheDocument();
      });
      expect(expandButton()).toBeDisabled();
    });

    it('keeps the level-toggle buttons on tablet-ish viewports', async () => {
      // withMobileCalendarViewport simulates a tablet-ish width (under the
      // 'md' breakpoint only) — the buttons should still show there.
      const restoreTabletViewport = withMobileCalendarViewport();
      try {
        setUpMultiLocationFixture();
        renderWithAuth();
        await screen.findByText('Karottenbeet');
        expect(screen.getByRole('button', { name: 'Eine Hierarchieebene ausblenden' })).toBeInTheDocument();
      } finally {
        restoreTabletViewport();
      }
    });

    it('hides the level-toggle buttons on phone-sized viewports', async () => {
      const restorePhoneViewport = withPhoneCalendarViewport();
      try {
        setUpMultiLocationFixture();
        renderWithAuth();
        await screen.findByText('Karottenbeet');
        expect(screen.queryByRole('button', { name: 'Eine Hierarchieebene ausblenden' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Eine Hierarchieebene mehr anzeigen' })).not.toBeInTheDocument();
      } finally {
        restorePhoneViewport();
      }
    });

    it('uses compact search and filter controls on mobile', async () => {
      const restoreViewport = withMobileCalendarViewport();
      try {
        setUpMultiLocationFixture();
        renderWithAuth();

        await screen.findByText('Karottenbeet');
        expect(screen.queryByPlaceholderText('Suche nach Kultur, Beet, Parzelle oder Standort…')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Suchen' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Filter (1)' })).toBeInTheDocument();
        expect(screen.queryByText('Nur belegte Beete')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
        fireEvent.change(await screen.findByPlaceholderText('Suche nach Kultur, Beet, Parzelle oder Standort…'), {
          target: { value: 'Karotte' },
        });

        await waitFor(() => {
          expect(screen.getByPlaceholderText('Suche nach Kultur, Beet, Parzelle oder Standort…')).toHaveValue('Karotte');
          expect(screen.queryByText('Suche: Karotte')).not.toBeInTheDocument();
          expect(screen.queryByText('Tomatenbeet')).not.toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Filter (1)' }));
        expect(await screen.findByText('Nur belegte Beete')).toBeInTheDocument();
        fireEvent.mouseDown(await screen.findByLabelText('Standort'));
        fireEvent.click(await screen.findByRole('option', { name: 'Pacht' }));

        await waitFor(() => {
          expect(screen.getAllByText('Pacht').length).toBeGreaterThanOrEqual(2);
          expect(screen.getByText('Filter (2)')).toBeInTheDocument();
        });
      } finally {
        restoreViewport();
      }
    });
  });

  describe('context navigation, double-click, and compact row heights', () => {
    const setUpSinglePlanFixture = () => {
      mocks.planList.mockResolvedValue({
        data: {
          results: [{
            id: 10,
            crop: 5,
            crop_name: 'Salat',
            bed: 3,
            planting_date: '2026-04-01',
            harvest_date: '2026-05-01',
          }],
        },
      });
      mocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: 'Salat' }] } });
    };

    it('double-clicking a task bar navigates to and opens its existing planting plan', async () => {
      setUpSinglePlanFixture();
      renderWithAuth();

      await screen.findByText('Beet 1');
      fireEvent.click(screen.getByRole('button', { name: /^open-task-/ }));

      expect(mocks.navigate).toHaveBeenCalledWith('/app/planting-plans?planId=10');
    });

    it('a task context menu offers plan/crop/bed navigation plus edit, copy, and delete', async () => {
      setUpSinglePlanFixture();
      renderWithAuth();

      await screen.findByText('Beet 1');
      fireEvent.click(screen.getByRole('button', { name: /^context-menu-task-/ }));

      expect(await screen.findByRole('menuitem', { name: 'Anbauplan öffnen' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Kultur öffnen' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Beet öffnen' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Bearbeiten' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Zeile kopieren' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeInTheDocument();
    });

    it('choosing "Anbauplan öffnen" from the task context menu navigates to the plan', async () => {
      setUpSinglePlanFixture();
      renderWithAuth();

      await screen.findByText('Beet 1');
      fireEvent.click(screen.getByRole('button', { name: /^context-menu-task-/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Anbauplan öffnen' }));

      expect(mocks.navigate).toHaveBeenCalledWith('/app/planting-plans?planId=10');
    });

    it('choosing "Bearbeiten" from the task context menu navigates to the plan in edit mode', async () => {
      setUpSinglePlanFixture();
      renderWithAuth();

      await screen.findByText('Beet 1');
      fireEvent.click(screen.getByRole('button', { name: /^context-menu-task-/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Bearbeiten' }));

      expect(mocks.navigate).toHaveBeenCalledWith('/app/planting-plans?planId=10&edit=true');
    });

    it('choosing "Löschen" from the task context menu deletes the plan after confirmation', async () => {
      setUpSinglePlanFixture();
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderWithAuth();

      await screen.findByText('Beet 1');
      fireEvent.click(screen.getByRole('button', { name: /^context-menu-task-/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Löschen' }));

      await waitFor(() => expect(mocks.planDelete).toHaveBeenCalledWith(10));
      confirmSpy.mockRestore();
    });

    it('a Standort row context menu offers open/edit actions scoped to the location', async () => {
      setUpSinglePlanFixture();
      renderWithAuth();

      await screen.findByText('Beet 1');
      fireEvent.click(screen.getByRole('button', { name: 'context-menu-group-Hof' }));

      expect(await screen.findByRole('menuitem', { name: 'Standort öffnen' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Standort bearbeiten' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Beet öffnen' })).not.toBeInTheDocument();
    });

    it('a Beet row context menu includes "Anbauplan hinzufügen"', async () => {
      setUpSinglePlanFixture();
      renderWithAuth();

      await screen.findByText('Beet 1');
      fireEvent.click(screen.getByRole('button', { name: 'context-menu-group-Beet 1' }));

      expect(await screen.findByRole('menuitem', { name: 'Anbauplan hinzufügen' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Anbauplan hinzufügen' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/app/planting-plans?bedId=3&create=true');
    });

    it('gives Standort and Parzelle rows a compact row height and leaves Beet rows at their normal computed height', async () => {
      setUpSinglePlanFixture();
      renderWithAuth();

      await screen.findByText('Beet 1');

      const locationHeight = Number(screen.getByTestId('row-height-Hof').textContent);
      const fieldHeight = Number(screen.getByTestId('row-height-Feld').textContent);
      const bedHeightText = screen.getByTestId('row-height-Beet 1').textContent;

      expect(locationHeight).toBeGreaterThan(0);
      expect(locationHeight).toBeLessThan(60);
      expect(fieldHeight).toBe(locationHeight);
      // Beet rows keep the library's normal task-count-based height (no override).
      expect(bedHeightText).toBe('auto');
    });
  });
});
