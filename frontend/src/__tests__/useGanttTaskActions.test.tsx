import { renderHook, act } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { PlantingPlan } from '../api/api';
import i18n from '../i18n';
import type { GanttTask, GanttTaskGroup } from '../pages/ganttChartUtils';
import { useGanttTaskActions } from '../pages/useGanttTaskActions';

const { deleteMock, confirmMock, copyMock } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  confirmMock: vi.fn(),
  copyMock: vi.fn(),
}));

vi.mock('../api/api', () => ({ plantingPlanAPI: { delete: deleteMock } }));
vi.mock('../utils/confirmAction', () => ({ confirmAction: confirmMock }));
vi.mock('../components/data-grid', () => ({ copyTextToClipboardSilently: copyMock }));

const t = i18n.getFixedT('de') as TFunction;

const task = (overrides: Partial<GanttTask> = {}): GanttTask => ({
  id: 't1',
  name: 'Aufgabe',
  plantingPlanId: 5,
  cropName: 'Möhre',
  cropVariety: 'Nantaise',
  startDate: new Date(2026, 2, 15),
  endDate: new Date(2026, 5, 20),
  ...overrides,
} as GanttTask);

const group = (overrides: Partial<GanttTaskGroup> = {}): GanttTaskGroup => ({
  id: 'g1', name: 'Beet A', tasks: [], ...overrides,
} as GanttTaskGroup);

const PLANS = [{ id: 5, crop: 42 }, { id: 6, crop: null }] as unknown as PlantingPlan[];

const setup = ({ plantingPlans = PLANS } = {}) => {
  const navigate = vi.fn();
  const setPlantingPlans = vi.fn();
  const setError = vi.fn();
  const { result, rerender } = renderHook(() => useGanttTaskActions({
    navigate: navigate as never, plantingPlans, setPlantingPlans, setError, t,
  }));
  return { result, rerender, navigate, setPlantingPlans, setError };
};

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockReturnValue(true);
  deleteMock.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openPlantingPlanFromTask', () => {
  it('deep-links to the plan', () => {
    const { result, navigate } = setup();

    act(() => result.current.openPlantingPlanFromTask(task()));

    expect(navigate).toHaveBeenCalledWith('/app/planting-plans?planId=5');
  });

  it('asks the page to open the row for editing when requested', () => {
    const { result, navigate } = setup();

    act(() => result.current.openPlantingPlanFromTask(task(), { edit: true }));

    expect(navigate).toHaveBeenCalledWith('/app/planting-plans?planId=5&edit=true');
  });

  it('does not add the edit flag when it is explicitly false', () => {
    const { result, navigate } = setup();

    act(() => result.current.openPlantingPlanFromTask(task(), { edit: false }));

    expect(navigate).toHaveBeenCalledWith('/app/planting-plans?planId=5');
  });

  it('falls back to the plain list for a task with no plan behind it', () => {
    // Structural rows (a location or field summary) carry no plan id.
    const { result, navigate } = setup();

    act(() => result.current.openPlantingPlanFromTask(task({ plantingPlanId: undefined })));

    expect(navigate).toHaveBeenCalledWith('/app/planting-plans');
  });

  it('double-clicking opens the plan without edit mode', () => {
    const { result, navigate } = setup();

    act(() => result.current.handleTaskDoubleClickToPlan(task()));

    expect(navigate).toHaveBeenCalledWith('/app/planting-plans?planId=5');
  });

  it('keeps the double-click wrapper stable across renders', () => {
    // It is handed to the Gantt component as a prop; a fresh arrow each render
    // would re-render the chart for nothing. `setup` holds every input identity
    // stable across the rerender, so a fresh wrapper can only come from the
    // hook dropping its memo -- not from the fixture invalidating the deps.
    const { result, rerender } = setup();
    const first = result.current.handleTaskDoubleClickToPlan;

    rerender();

    expect(result.current.handleTaskDoubleClickToPlan).toBe(first);
  });
});

describe('openCropFromTask', () => {
  it('deep-links to the crop behind the task', () => {
    const { result, navigate } = setup();

    act(() => result.current.openCropFromTask(task()));

    expect(navigate).toHaveBeenCalledWith('/app/crops?cropId=42');
  });

  it('does nothing when the plan has no crop', () => {
    // Navigating to `cropId=null` would land on a blank detail pane.
    const { result, navigate } = setup();

    act(() => result.current.openCropFromTask(task({ plantingPlanId: 6 })));

    expect(navigate).not.toHaveBeenCalled();
  });

  it('does nothing when the plan is not loaded', () => {
    const { result, navigate } = setup();

    act(() => result.current.openCropFromTask(task({ plantingPlanId: 999 })));

    expect(navigate).not.toHaveBeenCalled();
  });

  it('does nothing for a task with no plan at all', () => {
    const { result, navigate } = setup();

    act(() => result.current.openCropFromTask(task({ plantingPlanId: undefined })));

    expect(navigate).not.toHaveBeenCalled();
  });

  it('sees plans that only arrive after the first render', () => {
    // The chart mounts before the plan request resolves, so the very first
    // render always gets an empty list. A memo that does not list
    // `plantingPlans` as a dependency keeps that empty closure and the crop
    // link silently stops working -- which only a rerender with new data
    // exposes, never a fresh mount.
    const navigate = vi.fn();
    const { result, rerender } = renderHook(
      ({ plantingPlans }: { plantingPlans: PlantingPlan[] }) => useGanttTaskActions({
        navigate: navigate as never,
        plantingPlans,
        setPlantingPlans: vi.fn(),
        setError: vi.fn(),
        t,
      }),
      { initialProps: { plantingPlans: [] as PlantingPlan[] } },
    );

    act(() => result.current.openCropFromTask(task()));
    expect(navigate).not.toHaveBeenCalled();

    rerender({ plantingPlans: PLANS });
    act(() => result.current.openCropFromTask(task()));

    expect(navigate).toHaveBeenCalledWith('/app/crops?cropId=42');
  });
});

describe('addPlantingPlanForBed', () => {
  it('opens the plan page prefilled for that bed', () => {
    const { result, navigate } = setup();

    act(() => result.current.addPlantingPlanForBed(group({ bedId: 3 } as never)));

    expect(navigate).toHaveBeenCalledWith('/app/planting-plans?bedId=3&create=true');
  });

  it('does nothing for a group that is not a bed', () => {
    // Location and field rows group beds; a plan cannot be added to them.
    const { result, navigate } = setup();

    act(() => result.current.addPlantingPlanForBed(group()));

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('openAreasPage', () => {
  it('opens the areas page with nothing highlighted', () => {
    const { result, navigate } = setup();

    act(() => result.current.openAreasPage());

    expect(navigate).toHaveBeenCalledWith('/app/fields-beds');
  });

  it.each([
    ['location', 1, '/app/fields-beds?highlight=location:1'],
    ['field', 2, '/app/fields-beds?highlight=field:2'],
    ['bed', 3, '/app/fields-beds?highlight=bed:3'],
  ] as const)('deep-links to a %s row', (type, id, expected) => {
    const { result, navigate } = setup();

    act(() => result.current.openAreasPage({ type, id }));

    expect(navigate).toHaveBeenCalledWith(expected);
  });
});

describe('copyTaskSummary', () => {
  it('copies the crop, the row and the dates', () => {
    const { result } = setup();

    act(() => result.current.copyTaskSummary(task(), group()));

    expect(copyMock).toHaveBeenCalledWith('Möhre (Nantaise) · Beet A · 15.3.2026 – 20.6.2026');
  });

  it('uses the crop name alone when there is no variety', () => {
    const { result } = setup();

    act(() => result.current.copyTaskSummary(task({ cropVariety: undefined }), group()));

    expect(copyMock).toHaveBeenCalledWith('Möhre · Beet A · 15.3.2026 – 20.6.2026');
  });

  it('falls back to the task name when the crop is unknown', () => {
    // Structural rows have a name but no crop.
    const { result } = setup();

    act(() => result.current.copyTaskSummary(
      task({ cropName: undefined, name: 'Sammelzeile' }), group(),
    ));

    expect(copyMock).toHaveBeenCalledWith('Sammelzeile · Beet A · 15.3.2026 – 20.6.2026');
  });

  it('drops an empty part rather than leaving a dangling separator', () => {
    const { result } = setup();

    act(() => result.current.copyTaskSummary(
      task({ cropName: undefined, name: '' }), group({ name: '' } as never),
    ));

    expect(copyMock).toHaveBeenCalledWith('15.3.2026 – 20.6.2026');
  });

  it('copies silently, without a snackbar of its own', () => {
    // The context menu closing is the feedback; a snackbar on top would be
    // two acknowledgements for one action.
    const { result } = setup();

    act(() => result.current.copyTaskSummary(task(), group()));

    expect(copyMock).toHaveBeenCalledTimes(1);
  });
});

describe('deletePlantingPlanFromTask', () => {
  it('asks before deleting', () => {
    const { result } = setup();

    act(() => { void result.current.deletePlantingPlanFromTask(task()); });

    expect(confirmMock).toHaveBeenCalledWith(
      'Diesen Anbauplan wirklich löschen?',
    );
  });

  it('deletes the plan and drops it from the chart', async () => {
    const { result, setPlantingPlans } = setup();

    await act(async () => { await result.current.deletePlantingPlanFromTask(task()); });

    expect(deleteMock).toHaveBeenCalledWith(5);
    const updater = setPlantingPlans.mock.calls[0][0] as (p: PlantingPlan[]) => PlantingPlan[];
    expect(updater(PLANS).map((plan) => plan.id)).toEqual([6]);
  });

  it('does nothing when the user cancels', async () => {
    confirmMock.mockReturnValue(false);
    const { result, setPlantingPlans } = setup();

    await act(async () => { await result.current.deletePlantingPlanFromTask(task()); });

    expect(deleteMock).not.toHaveBeenCalled();
    expect(setPlantingPlans).not.toHaveBeenCalled();
  });

  it('does not even ask for a task with no plan behind it', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.deletePlantingPlanFromTask(task({ plantingPlanId: undefined }));
    });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('reports a failed delete in German and leaves the chart untouched', async () => {
    // Removing the row locally after a failed delete would show the user a
    // plan that still exists on the server. The message is pinned exactly:
    // asserting only that *some* string arrived cannot tell a localized
    // message apart from a raw `Error.message` leaking through.
    //
    // Note it is the shared generic text, not the `ganttChart:errors.updatePlan`
    // fallback this hook passes in. `extractApiErrorMessage` prefers a
    // translated `errors.generic`, which the default namespace defines, so the
    // caller-supplied fallback only ever surfaces if that key goes missing.
    deleteMock.mockRejectedValue(new Error('offline'));
    const { result, setError, setPlantingPlans } = setup();

    await act(async () => { await result.current.deletePlantingPlanFromTask(task()); });

    expect(setError).toHaveBeenCalledWith(
      'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.',
    );
    expect(setPlantingPlans).not.toHaveBeenCalled();
  });

  it('surfaces the backend validation message instead of the generic one', async () => {
    // A real AxiosError, not a lookalike: `extractApiErrorMessage` only unpacks
    // a DRF payload behind `axios.isAxiosError`, so a plain object with a
    // `response` would fall through to the generic text and prove nothing.
    const rejection = new AxiosError('Request failed with status code 400');
    rejection.response = {
      status: 400,
      statusText: 'Bad Request',
      data: { non_field_errors: ['Bed not found.'] },
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    };
    deleteMock.mockRejectedValue(rejection);
    const { result, setError } = setup();

    await act(async () => { await result.current.deletePlantingPlanFromTask(task()); });

    expect(setError).toHaveBeenCalledWith('Fehler: Das Beet wurde nicht gefunden.');
  });
});
