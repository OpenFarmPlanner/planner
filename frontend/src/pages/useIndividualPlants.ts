import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { plantingPlanAPI } from '../api/api';
import type {
  IndividualPlacementInput, PlantingPlan, PlanCultivationType, Season, StemCoordinates,
} from '../api/types';
import { formatDateToAPI } from '../utils/isoDate';
import { planPlacementParent, type PlacementParent } from './individualPlantGeometry';
import { MAX_INDIVIDUAL_POSITIONS } from './individualPlantGeneration';

export type DraftStem = StemCoordinates & { id?: string; key: string };
export type IndividualPlacementAction = 'edit' | 'add' | 'remove';

interface Draft {
  planId?: number;
  expectedUpdatedAt?: string;
  parent: PlacementParent;
  crop: number | null;
  date: string;
  cultivation: PlanCultivationType | '';
  canopy: number | string | null | undefined;
  stems: DraftStem[];
}

export function readyForPlacement(draft: Draft, season: Season) {
  return Boolean(draft.planId || (draft.crop && draft.cultivation
    && draft.date >= season.start_date && draft.date <= season.end_date));
}

interface Editor {
  open: boolean;
  parent: PlacementParent | null;
  choosingParent: boolean;
  planId: number | null;
  selectedKey: string | null;
  draft: Draft | null;
  placing: 'add' | null;
  saving: boolean;
  error: 'saveFailed' | 'changedElsewhere' | null;
}

const initialEditor: Editor = {
  open: false, parent: null, choosingParent: false, planId: null, selectedKey: null,
  draft: null, placing: null, saving: false, error: null,
};

type PlanResult = { key: string; plans: PlantingPlan[]; failed: boolean };
const NO_PLANS: PlantingPlan[] = [];

function placementDraft(parent: PlacementParent, season: Season, plan?: PlantingPlan): Draft {
  const today = formatDateToAPI(new Date());
  const defaultDate = today < season.start_date ? season.start_date : today > season.end_date ? season.end_date : today;
  return {
    planId: plan?.id, expectedUpdatedAt: plan?.updated_at, parent,
    crop: plan?.crop ?? null, date: plan?.planting_date ?? defaultDate,
    cultivation: plan?.cultivation_type ?? '', canopy: plan?.estimated_canopy_diameter_m,
    stems: plan?.individual_positions?.map(stem => ({ ...stem, key: stem.id })) ?? [],
  };
}

export function useIndividualPlants(
  location: number | null, season: Season | undefined, canEdit: boolean, requestedPlan?: number, requestedEdit = false,
) {
  const scope = location && season?.id ? `${location}:${season.id}` : '';
  const [attempt, setAttempt] = useState(0);
  const key = `${scope}:${attempt}`;
  const [result, setResult] = useState<PlanResult | null>(null);
  const [state, setState] = useState({ scope, editor: initialEditor });
  const nextStemId = useRef(0);
  const revealedPlan = useRef<string | null>(null);
  // Bumped on every completed load: a direct move only writes into the load it started from.
  const loadGeneration = useRef(0);
  const saving = useRef(false);
  const [movingPlans, setMovingPlans] = useState<ReadonlySet<number>>(new Set());
  if (state.scope !== scope) setState({ scope, editor: initialEditor });
  const editor = state.scope === scope ? state.editor : initialEditor;
  const current = result?.key === key ? result : null;
  const plans = current?.plans ?? NO_PLANS;

  useEffect(() => {
    if (!location || !scope || !season) return;
    const abort = new AbortController();
    void plantingPlanAPI.listIndividualAtLocation(location, abort.signal).then(({ results }) => {
      if (abort.signal.aborted) return;
      loadGeneration.current += 1;
      setResult({ key, plans: results, failed: false });
      const requestKey = requestedPlan ? `${scope}:${requestedPlan}:${requestedEdit}` : null;
      const requested = requestKey && requestKey !== revealedPlan.current
        ? results.find(plan => plan.id === requestedPlan) : undefined;
      const parent = requested ? planPlacementParent(requested) : null;
      const planId = requested?.id;
      if (planId === undefined || !parent) return;
      revealedPlan.current = requestKey;
      setState(value => value.scope === scope ? {
        scope, editor: {
          ...initialEditor, open: true, planId, parent,
          selectedKey: requested?.individual_positions?.[0]?.id ?? null,
          draft: requestedEdit && canEdit ? placementDraft(parent, season, requested) : null,
        },
      } : value);
    }).catch(() => {
      if (!abort.signal.aborted) setResult({ key, plans: [], failed: true });
    });
    return () => abort.abort();
  }, [location, scope, key, requestedPlan, requestedEdit, canEdit, season]);

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

  const select = (planId: number | null, parent: PlacementParent | null, selectedKey: string | null = null) => {
    update(value => value.draft
      ? ((value.draft.planId ?? null) === planId ? { selectedKey } : {})
      : { open: true, choosingParent: false, planId, parent, selectedKey });
  };

  const startDraft = (parent: PlacementParent, plan?: PlantingPlan, selection?: {
    action: IndividualPlacementAction; stemId: string;
  }) => {
    // A direct move of this plan is still saving: a draft would start from a version about to change.
    if (!canEdit || !season || saving.current || (plan?.id && movingPlans.has(plan.id))) return;
    const draft = placementDraft(parent, season, plan);
    const action = selection?.action;
    const requestedStem = selection && draft.stems.find(stem => stem.key === selection.stemId);
    if (selection && (!requestedStem || !plan?.updated_at)) return;
    if (action === 'add' && draft.stems.length >= MAX_INDIVIDUAL_POSITIONS) return;
    if (action === 'remove') {
      if (draft.stems.length <= 1) return;
      draft.stems = draft.stems.filter(stem => stem.key !== selection?.stemId);
    }
    update(value => {
      if (selection && value.draft) return {};
      return {
        open: true, choosingParent: false, error: null, parent, planId: plan?.id ?? null,
        placing: !plan || action === 'add' ? 'add' : null,
        selectedKey: (action === 'remove' ? draft.stems[0] : requestedStem || draft.stems[0])?.key ?? null,
        draft,
      };
    });
  };

  const addStems = (points: readonly StemCoordinates[]) => {
    const added = points.map(point => ({ ...point, key: `new-${nextStemId.current++}` }));
    update(value => {
      if (!value.draft || !added.length || value.draft.stems.length + added.length > MAX_INDIVIDUAL_POSITIONS) return {};
      return {
        draft: { ...value.draft, stems: [...value.draft.stems, ...added] },
        selectedKey: added[added.length - 1].key, error: null,
      };
    });
  };
  const addStem = (point: StemCoordinates) => addStems([point]);

  const changeStem = (stemKey: string, point: StemCoordinates | null) => update(value => {
    if (!value.draft) return {};
    if (!point && value.draft.planId && value.draft.stems.length <= 1) return {};
    const stems = point
      ? value.draft.stems.map(stem => stem.key === stemKey ? { ...stem, ...point } : stem)
      : value.draft.stems.filter(stem => stem.key !== stemKey);
    return {
      draft: { ...value.draft, stems }, error: null,
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
          ...data, crop: draft.crop, planting_date: draft.date,
          ...(draft.parent.kind === 'bed'
            ? { placement_mode: 'individual_bed', bed: draft.parent.id }
            : { placement_mode: 'individual_parcel', parcel: draft.parent.id }),
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
      // A failure from a load the user has since left neither reports nor refreshes anything.
      if (loadGeneration.current !== generation) return;
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
    plans, editor, canEdit, update, updateDraft, select, startDraft, addStem, addStems, changeStem, save,
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
