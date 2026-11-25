import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { plantingPlanAPI } from '../api/api';
import type {
  IndividualPlacementInput, PlantingPlan, PlanCultivationType, Season, StemCoordinates,
} from '../api/types';
import { formatDateToAPI } from '../utils/isoDate';

export const MAX_INDIVIDUAL_POSITIONS = 1000;
export type DraftStem = StemCoordinates & { id?: string; key: string };

interface Draft {
  planId?: number;
  expectedUpdatedAt?: string;
  parcel: number;
  crop: number | null;
  date: string;
  cultivation: PlanCultivationType | '';
  canopy: number | string | null | undefined;
  stems: DraftStem[];
}

interface Editor {
  open: boolean;
  parcel: number | null;
  planId: number | null;
  selectedKey: string | null;
  draft: Draft | null;
  placing: 'add' | 'move' | null;
  saving: boolean;
  error: 'saveFailed' | 'changedElsewhere' | null;
}

const initialEditor: Editor = {
  open: false, parcel: null, planId: null, selectedKey: null,
  draft: null, placing: null, saving: false, error: null,
};

type PlanResult = { key: string; plans: PlantingPlan[]; failed: boolean };

export function useIndividualPlants(
  location: number | null, season: Season | undefined, canEdit: boolean, requestedPlan?: number,
) {
  const scope = location && season?.id ? `${location}:${season.id}` : '';
  const [attempt, setAttempt] = useState(0);
  const key = `${scope}:${attempt}`;
  const [result, setResult] = useState<PlanResult | null>(null);
  const [state, setState] = useState({ scope, editor: initialEditor });
  const nextStemId = useRef(0);
  const revealedPlan = useRef<number | undefined>(undefined);
  // Bumped on every completed load: a direct move only writes into the load it started from.
  const loadGeneration = useRef(0);
  const saving = useRef(false);
  if (state.scope !== scope) setState({ scope, editor: initialEditor });
  const editor = state.scope === scope ? state.editor : initialEditor;
  const current = result?.key === key ? result : null;
  const plans = current?.plans ?? [];

  useEffect(() => {
    if (!location || !scope) return;
    const abort = new AbortController();
    void plantingPlanAPI.listIndividualAtLocation(location, abort.signal).then(({ results }) => {
      if (abort.signal.aborted) return;
      loadGeneration.current += 1;
      setResult({ key, plans: results, failed: false });
      const requested = requestedPlan !== revealedPlan.current
        ? results.find(plan => plan.id === requestedPlan) : undefined;
      if (!requested?.id || !requested.parcel) return;
      revealedPlan.current = requested.id;
      setState(value => value.scope === scope ? {
        scope, editor: {
          ...initialEditor, open: true, planId: requested.id ?? null, parcel: requested.parcel ?? null,
          selectedKey: requested.individual_positions?.[0]?.id ?? null,
        },
      } : value);
    }).catch(() => {
      if (!abort.signal.aborted) setResult({ key, plans: [], failed: true });
    });
    return () => abort.abort();
  }, [location, scope, key, requestedPlan]);

  const update = (changes: Partial<Editor> | ((source: Editor) => Partial<Editor>)) => {
    setState(value => {
      if (value.scope !== scope) return value;
      const next = typeof changes === 'function' ? changes(value.editor) : changes;
      return { scope, editor: { ...value.editor, ...next } };
    });
  };

  const updateDraft = (changes: Partial<Draft>) => update(value => ({
    draft: value.draft ? { ...value.draft, ...changes } : null, error: null,
  }));

  const select = (planId: number | null, parcel: number | null, selectedKey: string | null = null) => {
    update(value => value.draft
      ? ((value.draft.planId ?? null) === planId ? { selectedKey } : {})
      : { open: true, planId, parcel, selectedKey });
  };

  const startDraft = (parcel: number, plan?: PlantingPlan) => {
    if (!canEdit || !season || saving.current) return;
    const today = formatDateToAPI(new Date());
    const defaultDate = today < season.start_date ? season.start_date
      : today > season.end_date ? season.end_date : today;
    update({
      open: true, placing: null, error: null, parcel, planId: plan?.id ?? null,
      selectedKey: plan?.individual_positions?.[0]?.id ?? null,
      draft: {
        planId: plan?.id, expectedUpdatedAt: plan?.updated_at, parcel,
        crop: plan?.crop ?? null, date: plan?.planting_date ?? defaultDate,
        cultivation: plan?.cultivation_type ?? '',
        canopy: plan?.estimated_canopy_diameter_m,
        stems: plan?.individual_positions?.map(stem => ({ ...stem, key: stem.id })) ?? [],
      },
    });
  };

  const addStem = (point: StemCoordinates) => {
    const stem = { ...point, key: `new-${nextStemId.current++}` };
    update(value => {
      if (!value.draft || value.draft.stems.length >= MAX_INDIVIDUAL_POSITIONS) return {};
      return {
        draft: { ...value.draft, stems: [...value.draft.stems, stem] },
        placing: null, selectedKey: stem.key, error: null,
      };
    });
  };

  const changeStem = (stemKey: string, point: StemCoordinates | null) => update(value => {
    if (!value.draft) return {};
    const stems = point
      ? value.draft.stems.map(stem => stem.key === stemKey ? { ...stem, ...point } : stem)
      : value.draft.stems.filter(stem => stem.key !== stemKey);
    return {
      draft: { ...value.draft, stems }, error: null, placing: null,
      selectedKey: point ? stemKey : stems[0]?.key ?? null,
    };
  });

  const save = async () => {
    const draft = editor.draft;
    if (!canEdit || !draft || saving.current) return;
    saving.current = true;
    update({ saving: true, error: null, placing: null });
    const data: IndividualPlacementInput = {
      individual_positions: draft.stems.map(({ id, x_m, y_m }) => ({ id, x_m, y_m })),
      ...(draft.canopy === undefined ? {} : { estimated_canopy_diameter_m: draft.canopy }),
    };
    try {
      const { data: plan } = draft.planId && draft.expectedUpdatedAt
        ? await plantingPlanAPI.saveIndividualPlacement(draft.planId, draft.expectedUpdatedAt, data)
        : await plantingPlanAPI.createIndividual({
          ...data, parcel: draft.parcel, crop: draft.crop, planting_date: draft.date,
          cultivation_type: draft.cultivation,
        });
      setResult(value => value?.key === key ? {
        ...value, plans: [...value.plans.filter(item => item.id !== plan.id), plan],
      } : value);
      update({
        draft: null, saving: false, planId: plan.id ?? null,
        selectedKey: plan.individual_positions?.[0]?.id ?? null,
      });
    } catch (error) {
      update({
        saving: false,
        error: isAxiosError(error) && error.response?.status === 409 ? 'changedElsewhere' : 'saveFailed',
      });
    } finally {
      saving.current = false;
    }
  };

  // Graphic edit mode moves an already saved stem directly (#1579): the position is
  // saved on drop like a bed or parcel, and restored when the save fails.
  const [movingPlans, setMovingPlans] = useState<ReadonlySet<number>>(new Set());
  const [moveErrorScope, setMoveErrorScope] = useState<string | null>(null);
  const moveSavedStem = async (planId: number, stemId: string, point: StemCoordinates) => {
    const plan = plans.find(item => item.id === planId);
    if (!canEdit || !plan?.updated_at || movingPlans.has(planId)) return;
    const positions = (plan.individual_positions ?? []).map(stem => (
      stem.id === stemId ? { ...stem, ...point } : stem));
    const generation = loadGeneration.current;
    const replacePlan = (next: PlantingPlan) => setResult(value => (
      value?.key === key && loadGeneration.current === generation) ? {
      ...value, plans: value.plans.map(item => item.id === planId ? next : item),
    } : value);
    setMoveErrorScope(null);
    setMovingPlans(value => new Set(value).add(planId));
    replacePlan({ ...plan, individual_positions: positions });
    try {
      const { data } = await plantingPlanAPI.saveIndividualPlacement(planId, plan.updated_at, {
        individual_positions: positions.map(({ id, x_m, y_m }) => ({ id, x_m, y_m })),
      });
      replacePlan(data);
    } catch (error) {
      replacePlan(plan);
      setMoveErrorScope(scope);
      // The plan changed elsewhere: reload it so the next drag uses its current version.
      if (isAxiosError(error) && error.response?.status === 409) setAttempt(value => value + 1);
    } finally {
      setMovingPlans(value => {
        const next = new Set(value);
        next.delete(planId);
        return next;
      });
    }
  };

  return {
    plans, editor, canEdit, update, updateDraft, select, startDraft, addStem, changeStem, save,
    moveSavedStem, movingPlans, moveError: Boolean(scope) && moveErrorScope === scope,
    loading: Boolean(scope) && !current, failed: current?.failed ?? false,
    refresh: () => setAttempt(value => value + 1),
  };
}

export type IndividualPlantsController = ReturnType<typeof useIndividualPlants>;

/**
 * Saved plans whose stems graphic edit mode may drag and save directly (#1579): not while a
 * move of that plan is saving, and not for a plan with an open (possibly hidden) panel draft,
 * whose edits stay in that draft.
 */
export function getDirectlyDraggableStemPlans(
  controller: Pick<IndividualPlantsController, 'canEdit' | 'plans' | 'movingPlans' | 'editor'>,
): ReadonlySet<number> {
  if (!controller.canEdit) return new Set();
  return new Set(controller.plans.flatMap(plan => (
    plan.id && !controller.movingPlans.has(plan.id) && plan.id !== controller.editor.draft?.planId
      ? [plan.id] : [])));
}
