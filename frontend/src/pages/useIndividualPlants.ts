import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { plantingPlanAPI } from '../api/api';
import type {
  GraphicPlacementScene, GraphicStemPoint, IndividualPlacementInput, PlantingPlan, PlanCultivationType, Season, StemCoordinates,
} from '../api/types';
import { formatDateToAPI } from '../utils/isoDate';
import { placementParentFields, planPlacementParent, type PlacementParent } from './individualPlantGeometry';
import { MAX_INDIVIDUAL_POSITIONS } from './individualPlantGeneration';

type PointToAdd = StemCoordinates & { graphic?: GraphicStemPoint };
export type DraftStem = PointToAdd & { id?: string; key: string };
export type IndividualPlacementAction = 'edit' | 'add' | 'remove';

interface Draft {
  planId?: number;
  expectedUpdatedAt?: string;
  parent: PlacementParent;
  crop: number | null;
  date: string;
  cultivation: PlanCultivationType | '';
  canopy: number | string | null | undefined;
  count?: number | null;
  allowCountOnly: boolean;
  requestId: string;
  stems: DraftStem[];
}

const collisionErrors = {
  individual_geometry_changed: 'geometryChanged', individual_geometry_unknown: 'geometryUnknown',
  individual_parent_ambiguous: 'parentAmbiguous', individual_outside_location: 'outsideLocation',
  individual_split_protected: 'splitProtected', individual_count_exhausted: 'countExhausted',
  individual_request_changed: 'changedElsewhere', individual_placement_changed: 'changedElsewhere',
} as const;
type PlacementError = (typeof collisionErrors)[keyof typeof collisionErrors] | 'saveFailed';

function saveError(error: unknown): PlacementError {
  if (!isAxiosError(error) || error.response?.status !== 409) return 'saveFailed';
  const key = error.response.data?.code as keyof typeof collisionErrors | undefined;
  return key ? collisionErrors[key] ?? 'changedElsewhere' : 'changedElsewhere';
}

export function readyForPlacement(draft: Draft, season: Season) {
  return Boolean(draft.planId || (draft.crop && draft.cultivation
    && draft.date >= season.start_date && draft.date <= season.end_date));
}

interface Editor {
  open: boolean;
  parent: PlacementParent | null;
  planId: number | null;
  selectedKey: string | null;
  draft: Draft | null;
  placing: 'add' | null;
  saving: boolean;
  error: PlacementError | null;
}

const initialEditor: Editor = {
  open: false, parent: null, planId: null, selectedKey: null,
  draft: null, placing: null, saving: false, error: null,
};

type PlanResult = { key: string; plans: PlantingPlan[]; failed: boolean };
const NO_PLANS: PlantingPlan[] = [];

function placementDraft(parent: PlacementParent, season: Season, plan?: PlantingPlan, allowCountOnly = false): Draft {
  const today = formatDateToAPI(new Date());
  const defaultDate = today < season.start_date ? season.start_date : today > season.end_date ? season.end_date : today;
  return {
    planId: plan?.id, expectedUpdatedAt: plan?.updated_at, parent,
    crop: plan?.crop ?? null, date: plan?.planting_date ?? defaultDate,
    cultivation: plan?.cultivation_type ?? '', canopy: plan?.estimated_canopy_diameter_m,
    count: plan?.individual_count, allowCountOnly,
    requestId: crypto.randomUUID(),
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
      : { open: true, planId, parent, selectedKey });
  };

  const startDraft = (parent: PlacementParent, plan?: PlantingPlan, selection?: {
    action: IndividualPlacementAction; stemId: string;
  }, allowCountOnly = false) => {
    // A direct move of this plan is still saving: a draft would start from a version about to change.
    if (!canEdit || !season || saving.current || (plan?.id && movingPlans.has(plan.id))) return;
    const draft = placementDraft(parent, season, plan, allowCountOnly);
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
        open: true, error: null, parent, planId: plan?.id ?? null,
        placing: (!plan && !allowCountOnly) || action === 'add' ? 'add' : null,
        selectedKey: (action === 'remove' ? draft.stems[0] : requestedStem || draft.stems[0])?.key ?? null,
        draft,
      };
    });
  };

  const addStems = (points: readonly PointToAdd[]) => {
    const added = points.map(point => ({ ...point, key: `new-${nextStemId.current++}` }));
    update(value => {
      if (!value.draft || !added.length) return {};
      const limit = Math.min(MAX_INDIVIDUAL_POSITIONS, value.draft.count ?? MAX_INDIVIDUAL_POSITIONS);
      if (value.draft.stems.length + added.length > limit) return { error: 'countExhausted' };
      return {
        draft: { ...value.draft, stems: [...value.draft.stems, ...added] },
        selectedKey: added[added.length - 1].key, error: null,
      };
    });
  };
  const addStem = (point: PointToAdd) => addStems([point]);

  const changeStem = (stemKey: string, point: PointToAdd | null) => update(value => {
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

  const save = async (scene?: GraphicPlacementScene) => {
    const draft = editor.draft;
    if (!canEdit || !draft || saving.current) return;
    saving.current = true;
    update({ saving: true, error: null, placing: null });
    const positions = draft.stems.flatMap(stem => stem.graphic ? [stem.graphic] : []);
    const data: IndividualPlacementInput = {
      individual_positions: draft.stems.filter(stem => !stem.graphic).map(({ id, x_m, y_m }) => ({ id, x_m, y_m })),
      ...(draft.canopy === undefined ? {} : { estimated_canopy_diameter_m: draft.canopy }),
      ...(draft.count === undefined ? {} : { individual_count: draft.count }),
    };
    try {
      const saveLegacy = async () => draft.planId && draft.expectedUpdatedAt
        ? (await plantingPlanAPI.saveIndividualPlacement(draft.planId, draft.expectedUpdatedAt, data)).data
        : (await plantingPlanAPI.createIndividual({ ...data, ...placementParentFields(draft.parent),
          crop: draft.crop, planting_date: draft.date, cultivation_type: draft.cultivation })).data;
      if (positions.length && !scene) {
        update({ error: 'geometryChanged', saving: false });
        return;
      }
      const saved = scene && positions.length ? (await plantingPlanAPI.saveGraphicPlacement({
        request_id: draft.requestId, scene, points: positions,
        estimated_canopy_diameter_m: draft.canopy,
        ...(draft.planId ? { plan: draft.planId, placement_updated_at: draft.expectedUpdatedAt,
          existing_positions: data.individual_positions, individual_count: draft.count }
          : { crop: draft.crop ?? undefined, planting_date: draft.date, cultivation_type: draft.cultivation,
            ...(draft.count == null ? {} : { individual_count: draft.count, pending_parent: draft.parent }) }),
      })).data.plans : [await saveLegacy()];
      setResult(value => value?.key === key ? {
        ...value, plans: [...value.plans.filter(item => !saved.some(plan => item.id === plan.id)), ...saved],
      } : value);
      const plan = saved.find(item => item.id === draft.planId) ?? saved[0];
      update({
        draft: null, saving: false, planId: plan?.id ?? null,
        parent: plan ? planPlacementParent(plan) : null,
        selectedKey: plan?.individual_positions?.[0]?.id ?? null,
      });
    } catch (error) {
      update({
        saving: false,
        error: saveError(error),
      });
    } finally {
      saving.current = false;
    }
  };

  // Graphic edit mode moves an already saved stem directly (#1579): the position is
  // saved on drop like a bed or parcel, and restored when the save fails.
  const [moveFailure, setMoveFailure] = useState<{ scope: string; error: PlacementError } | null>(null);
  const moveSavedStem = async (planId: number, stemId: string, point: StemCoordinates,
    resolved?: { scene: GraphicPlacementScene; point: GraphicStemPoint }) => {
    const plan = plans.find(item => item.id === planId);
    if (!canEdit || !plan?.updated_at || movingPlans.has(planId)) return;
    const positions = (plan.individual_positions ?? []).map(stem => (
      stem.id === stemId ? { ...stem, ...point } : stem));
    const generation = loadGeneration.current;
    const replacePlan = (next: PlantingPlan) => setResult(value => (
      value?.key === key && loadGeneration.current === generation) ? {
      ...value, plans: value.plans.map(item => item.id === planId ? next : item),
    } : value);
    setMoveFailure(null);
    setMovingPlans(value => new Set(value).add(planId));
    if (!resolved) replacePlan({ ...plan, individual_positions: positions });
    try {
      if (resolved) {
        const { data } = await plantingPlanAPI.moveGraphicStem(planId, stemId, plan.updated_at, resolved.scene, resolved.point);
        setResult(value => value?.key === key && loadGeneration.current === generation ? {
          ...value, plans: [...value.plans.filter(item => !data.plans.some(saved => saved.id === item.id)), ...data.plans],
        } : value);
      } else {
        const { data } = await plantingPlanAPI.saveIndividualPlacement(planId, plan.updated_at, {
          individual_positions: positions.map(({ id, x_m, y_m }) => ({ id, x_m, y_m })),
        });
        replacePlan(data);
      }
    } catch (error) {
      // A failure from a load the user has since left neither reports nor refreshes anything.
      if (loadGeneration.current !== generation) return;
      replacePlan(plan);
      setMoveFailure({ scope, error: saveError(error) });
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
    moveSavedStem, movingPlans, moveError: moveFailure?.scope === scope ? moveFailure.error : null,
    reportMoveError: (error: PlacementError) => setMoveFailure({ scope, error }),
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
