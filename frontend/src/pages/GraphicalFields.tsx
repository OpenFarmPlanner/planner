import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  Stack,
  Typography,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import { Group, Layer, Rect, Stage, type KonvaNodeEvents } from "react-konva";
import type Konva from "konva";
import { alpha } from "@mui/material/styles";
import useEventCallback from '@mui/utils/useEventCallback';
import type { KonvaEventObject } from "konva/lib/Node";
import { useHierarchyData } from "../components/hierarchy/hooks/useHierarchyData";
import { getLocationPathSpacing } from "../components/hierarchy/utils/locationPathSpacing";
import {
  layoutAPI,
  type BedLayoutEntry,
  type FieldLayoutEntry,
  type LocationBoundaryOrigin,
} from "../api/api";
import { isTypingInEditableElement, useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useTranslation } from "../i18n";
import { GraphicalObjectHint, GraphicalObjectOverlays, type GraphicalAreaObject, type GraphicalObject } from "./GraphicalObjectOverlays";
import { graphicalObjectKey, useGraphicalObjectInteraction } from "./useGraphicalObjectInteraction";
import { useContextMenuHint } from "../components/data-grid/useContextMenuHint";
import { useTouchOnly } from '../hooks/useTouchOnly';
import { GraphicalFreeRectangles } from "./GraphicalFreeAreas";
import { GraphicalDisplayLegend } from "./GraphicalDisplayLegend";
import { GraphicalBedLabels } from "./GraphicalBedLabels";
import { bedCropDisplayName, bedCropPhaseLabel, includesCrops, includesTasks, indexBedCultivations, projectBedCultivation } from "./graphicalCultivation";
import { graphicalBedCropFill, graphicalCropPhaseColor, graphicalGeometryOutline } from './graphicalDisplayStyle';
import { GraphicalCanvasTools } from "./GraphicalCanvasTools";
import { bedTaskColors } from "./graphicalBedTaskStyle";
import { bedTaskDateBounds, orderBedTasks, summarizeBedTasks } from "../components/tasks/bedTaskUrgency";
import { useAreaPlantingPlans, useBedTasks } from "../components/tasks/useBedTasks";
import { isOpenTask } from "../components/tasks/taskBoard";
import { getDirectlyDraggableStemPlans, readyForPlacement, useIndividualPlants, type IndividualPlacementAction } from "./useIndividualPlants";
import { matchesPlacementParent, parcelMeters, stemToCanvas, type PlacementDimensions, type PlacementParent } from "./individualPlantGeometry";
import { GraphicalIndividualPlantsLayer, type CanvasStem } from "./GraphicalIndividualPlantsLayer";
import { getIndividualPlantLabels, individualPlantObjectKey, placeIndividualPlantObjects, projectIndividualPlants,
  type GraphicalIndividualPlant } from "./graphicalIndividualPlants";
import { GraphicalIndividualPlantsPanel } from "./GraphicalIndividualPlantsPanel";
import { GraphicalFreePlantPlacement } from "./GraphicalFreePlantPlacement";
import { GraphicalAreaAnnotations } from './GraphicalAreaAnnotations';
import { useGraphicalAnnotationOverlays } from './useGraphicalAnnotationOverlays';
import { layoutAreaAnnotations, type AreaAnnotationObstacle, type AreaAnnotationSubject } from './graphicalAnnotationLayout';
import { createGraphicPlacementContext, createParentLocalPlacement } from "./graphicalPlantPlacement";
import { GraphicalGeometryWarnings } from "./GraphicalGeometryWarnings";
import { GraphicalSnapGuides } from "./GraphicalSnapGuides";
import { analyzeGraphicalGeometry, getBedWorldRect, getGeometryOutlines, getGraphicalBedLayout, getGraphicalFreeRects, getSchematicLocationLayout, previewPosition, type GeometryPreview, type GraphicalParcel, type OutlineKind } from "./graphicalAreaGeometry";
import ModeToggle from "../components/ModeToggle";
import {
  clampInsideBoundary,
  clampInsideParent,
  isRectOutsideBoundary,
  rectsOverlap,
  DEFAULT_GRAPHICAL_ROTATION,
  rotateRect,
  rotateRectBetweenSizes,
  turnRotation,
  type GraphicalRotation,
  type Rect as PlacementRect,
  type RectSize,
} from "./graphicalLayoutUtils";
import {
  clampViewportToStage,
  fitBoundsToStage,
  getContentBoundsFromRects,
  getVisibleElements,
  panViewport,
  projectViewportRect,
  startPanSession,
  toContentBounds,
  type ContentBounds,
  type PanSession,
  type ViewportState,
  zoomAroundPoint,
} from "./graphicalViewport";
import {
  FIELD_SNAP_THRESHOLD,
  FIELD_WORLD_PX_PER_METER,
  PAN_FAST_STEP,
  PAN_STEP,
  SNAP_THRESHOLD,
  ZOOM_STEP,
  getFitViewportPadding,
  type BedViewModel,
  type GraphicalFieldsProps,
  type GraphicalCameraState,
  type GuideLine,
  type InteractionMode,
  type Point,
  type RectViewModel,
} from "./graphicalFieldsGeometry";
import { useAreaDrag, type AreaDragOptions, type DragSnapping } from "./graphicalAreaDrag";
import { useGraphicalStageSize } from "./useGraphicalStageSize";
import { formatLocalizedNumber, getActiveFormattingLocale } from "../utils/numberLocalization";
import LoadRetryButton from '../components/LoadRetryButton';
import { hasPendingFieldLayout, saveTrackedBedLayout, saveTrackedFieldLayout, waitForLocationLayoutSaves } from './graphicalLayoutRequests';

const canvasPanOffsets = {
  up: [0, PAN_STEP], down: [0, -PAN_STEP], left: [PAN_STEP, 0], right: [-PAN_STEP, 0],
} as const;

function createCanvasTextMeasurer(font: string) {
  const context = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d')
    : typeof CanvasRenderingContext2D !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (context) context.font = font;
  return (value: string) => context?.measureText(value).width ?? Array.from(value).length * 6.5;
}

export default function GraphicalFields({
  showTitle = true,
  interactionMode: controlledInteractionMode,
  onInteractionModeChange,
  showModeToggle = true,
  activeSeasonId,
  displayMode = 'areas',
  cropReference,
  fullscreenDisplayControls,
  onFullscreenChange,
  individualSeason,
  canEditIndividualPlants = false,
  requestedIndividualPlan,
  editRequestedIndividualPlan,
  individualCreationTarget,
  onIndividualCreationHandled,
  onOpenBed,
  onOpenDetails,
  onOpenIndividualPlan,
  onOpenIndividualCrop,
  canCompleteTasks = false,
  hierarchyData,
  selectedLocationId,
  cameraState: controlledCameraState,
  onCameraStateChange,
}: GraphicalFieldsProps) {
  const { t } = useTranslation(["fields", "common", "ganttChart"]);
  const theme = useTheme();
  const getOutlineProps = (kind: OutlineKind | undefined, color: string, width: number) =>
    kind ? graphicalGeometryOutline(theme, kind) : { stroke: color, strokeWidth: width };
  const internalHierarchyData = useHierarchyData(hierarchyData === undefined);
  const { loading, error, locations, fields, beds } = hierarchyData ?? internalHierarchyData;
  const activeLocationId = locations.find(location => location.id === selectedLocationId)?.id
    ?? locations.find(location => typeof location.id === 'number' && location.id > 0)?.id ?? null;
  const individualPlants = useIndividualPlants(
    activeLocationId, individualSeason, canEditIndividualPlants, requestedIndividualPlan, editRequestedIndividualPlan,
  );
  const [placementCursor, setPlacementCursor] = useState<{ location: number; point: Point } | null>(null);
  const [draggedStem, setDraggedStem] = useState<{ location: number; key: string; point: Point } | null>(null);
  const showCrops = includesCrops(displayMode);
  const plantCropReference = showCrops ? cropReference : undefined;
  const focusedPlanId = individualPlants.editor.open ? individualPlants.editor.planId : null;
  const measureText = useMemo(() => ({
    plant: createCanvasTextMeasurer('11px Arial, sans-serif'),
    location: createCanvasTextMeasurer('12px Arial, sans-serif'),
    parcel: createCanvasTextMeasurer('bold 12px Arial, sans-serif'),
  }), []);
  const [layoutsByBed, setLayoutsByBed] = useState<
    Record<number, BedLayoutEntry>
  >({});
  const [layoutsByField, setLayoutsByField] = useState<
    Record<number, FieldLayoutEntry>
  >({});
  const [boundaryOriginByLocation, setBoundaryOriginByLocation] = useState<
    Record<number, LocationBoundaryOrigin | null>
  >({});
  const [layoutAttempt, setLayoutAttempt] = useState(0);
  const [layoutLoad, setLayoutLoad] = useState({ locationId: null as number | null, attempt: -1, error: false });
  const latestSavedBedLayouts = useRef(new Map<number, BedLayoutEntry>());
  const [layoutSaveErrorLocation, setLayoutSaveErrorLocation] = useState<number | null>(null);
  const layoutReady = activeLocationId === null || (layoutLoad.locationId === activeLocationId && layoutLoad.attempt === layoutAttempt);
  const layoutFailed = activeLocationId !== null && layoutReady && layoutLoad.error;
  const [activeGuides, setActiveGuides] = useState<GuideLine[]>([]);
  const [geometryPreview, setGeometryPreview] = useState<GeometryPreview | null>(null);
  const areaDrag = useAreaDrag();
  const [localInteractionMode, setLocalInteractionMode] =
    useState<InteractionMode>("view");
  const [editableLocationId, setEditableLocationId] = useState<number | null>(null);
  const interactionMode = controlledInteractionMode ?? localInteractionMode;
  const setInteractionMode = (mode: InteractionMode): void => {
    if (controlledInteractionMode === undefined) {
      setLocalInteractionMode(mode);
    }
    onInteractionModeChange?.(mode);
  };
  const globalEditMode = interactionMode === "edit";
  const [localCameraState, setLocalCameraState] = useState<GraphicalCameraState>({ viewports: {}, rotations: {} });
  const cameraState = controlledCameraState ?? localCameraState;
  const setCameraState = onCameraStateChange ?? setLocalCameraState;
  const { viewports: viewportByLocation, rotations: rotationByLocation } = cameraState;
  const setViewportByLocation = (update: (current: Record<number, ViewportState>) => Record<number, ViewportState>): void => {
    setCameraState(current => ({ ...current, viewports: update(current.viewports) }));
  };
  const setRotationByLocation = (update: (current: Record<number, GraphicalRotation>) => Record<number, GraphicalRotation>): void => {
    setCameraState(current => ({ ...current, rotations: update(current.rotations) }));
  };
  const objectInteractionEnabled = Boolean(activeLocationId && !loading && !error && layoutReady && !layoutFailed
    && !globalEditMode && editableLocationId !== activeLocationId && !individualPlants.editor.placing);
  const browseIndividualPlants = objectInteractionEnabled && !individualPlants.editor.draft;
  const objects = useGraphicalObjectInteraction(objectInteractionEnabled, activeLocationId, displayMode);
  const selectedBedId = objects.selection?.startsWith('bed:') ? Number(objects.selection.slice(4)) : null;
  const selectedPlantKey = objects.selection?.startsWith('plant:') ? objects.selection : null;
  const showTasks = includesTasks(displayMode);
  const loadLocationPlans = showCrops || showTasks;
  const locationPlans = useAreaPlantingPlans('location', loadLocationPlans ? activeLocationId : null, activeSeasonId);
  const selectedPlans = useAreaPlantingPlans('bed', loadLocationPlans ? null : selectedBedId, activeSeasonId);
  const bedTasks = useBedTasks('location', showTasks || selectedPlantKey || (showCrops && selectedBedId !== null) ? activeLocationId : null,
    activeSeasonId, { sharedPlans: locationPlans });
  const taskPlans = showTasks ? bedTasks.tasksByPlan : undefined;
  const plansByParent = useMemo(() => projectIndividualPlants(
    individualPlants.plans, plantCropReference, individualSeason, focusedPlanId, taskPlans,
  ), [individualPlants.plans, plantCropReference, individualSeason, focusedPlanId, taskPlans]);
  const selectedBedTasks = useBedTasks('bed', loadLocationPlans ? null : selectedBedId, activeSeasonId, { sharedPlans: selectedPlans });
  const previewTasks = loadLocationPlans ? bedTasks : selectedBedTasks;
  const planRequest = loadLocationPlans ? locationPlans : selectedPlans;
  const plansByBed = useMemo(() => indexBedCultivations(planRequest.plans), [planRequest.plans]);
  const cropsByBed = useMemo(() => {
    if (!cropReference || !individualSeason) return new Map();
    return new Map(Array.from(plansByBed, ([id, plans]) => [id, projectBedCultivation(plans, cropReference, individualSeason)]));
  }, [cropReference, individualSeason, plansByBed]);
  const openTasksByBed = useMemo(() => new Map(Array.from(bedTasks.tasksByBed,
    ([id, tasks]) => [id, orderBedTasks(tasks.filter(isOpenTask))])), [bedTasks.tasksByBed]);
  const { today, upcomingEnd } = bedTaskDateBounds(new Date());
  const taskSummaries = useMemo(() => new Map(Array.from(bedTasks.tasksByBed,
    ([id, tasks]) => [id, summarizeBedTasks(tasks, { today, upcomingEnd })])), [bedTasks.tasksByBed, today, upcomingEnd]);
  const plantTaskSummaries = useMemo(() => new Map(Array.from(bedTasks.tasksByPlan,
    ([id, tasks]) => [id, summarizeBedTasks(tasks, { today, upcomingEnd })])), [bedTasks.tasksByPlan, today, upcomingEnd]);
  const cropPreview = cropReference && selectedBedId !== null ? {
    reference: cropReference,
    entries: cropsByBed.get(selectedBedId) ?? [],
    loading: planRequest.loading,
    failed: planRequest.failed,
    refresh: planRequest.refresh,
  } : undefined;
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const finePointer = useMediaQuery('(pointer: fine)');
  const touchOnly = useTouchOnly();
  const device = touchOnly ? 'touch' : objects.device ?? (coarsePointer ? 'touch' : finePointer ? 'desktop' : null);
  const {
    showContextMenuHint, showTouchContextMenuHint, closeContextMenuHint, closeTouchContextMenuHint,
    markContextMenuHintUsed, markTouchContextMenuHintUsed,
  } = useContextMenuHint({
    contextKey: 'growing-areas-graphic',
    enabled: objectInteractionEnabled,
    isDesktop: device === 'desktop',
    isTouch: device === 'touch',
  });
  const usedHintGestures = useRef(new Set<'desktop' | 'touch'>());
  const menuGesture = objects.menu?.gesture;
  const objectMenuOpen = Boolean(objects.menu);
  useEffect(() => {
    if (menuGesture === 'touch') {
      markTouchContextMenuHintUsed();
      usedHintGestures.current.add(menuGesture);
    }
    if (menuGesture === 'desktop') {
      markContextMenuHintUsed();
      usedHintGestures.current.add(menuGesture);
    }
    if (!objectMenuOpen) {
      if (usedHintGestures.current.has('touch')) closeTouchContextMenuHint();
      if (usedHintGestures.current.has('desktop')) closeContextMenuHint();
      usedHintGestures.current.clear();
    }
  }, [menuGesture, objectMenuOpen, closeContextMenuHint, closeTouchContextMenuHint,
    markContextMenuHintUsed, markTouchContextMenuHintUsed]);
  const activeCanvasRef = useRef<HTMLDivElement>(null);
  const annotationOverlays = useGraphicalAnnotationOverlays(activeCanvasRef, activeLocationId, layoutReady && !loading && !layoutFailed);
  const stageRefs = useRef<Record<number, Konva.Stage | null>>({});
  const canvasToolsRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const panSessionRef = useRef<Record<number, PanSession | null>>({});
  const pinchStateRef = useRef<
    Record<number, { distance: number; center: Point } | null>
  >({});
  const {
    stageWidth,
    stageHeight,
    fullscreenLocationId,
    containerRef,
    locationCanvasRefs,
    toggleFullscreen,
  } = useGraphicalStageSize(activeLocationId, !loading && layoutReady && !layoutFailed);
  useEffect(() => {
    onFullscreenChange?.(fullscreenLocationId !== null);
  }, [fullscreenLocationId, onFullscreenChange]);
  const resetTransientInteractionState = (): void => {
    setActiveGuides([]);
    setGeometryPreview(null);
    Object.keys(panSessionRef.current).forEach((key) => {
      panSessionRef.current[Number(key)] = null;
    });
    Object.keys(pinchStateRef.current).forEach((key) => {
      pinchStateRef.current[Number(key)] = null;
    });
  };

  const stopKonvaDragging = (): void => {
    Object.values(stageRefs.current).forEach((stage) => {
      stage?.stopDrag?.();
      stage?.find?.(".graphical-editable").forEach((node: Konva.Node) => {
        node.stopDrag?.();
      });
      stage?.batchDraw?.();
    });
  };

  useEffect(() => {
    let active = true;
    const loadLayouts = async (): Promise<void> => {
      if (activeLocationId === null) return;

      try {
        await waitForLocationLayoutSaves(activeLocationId);
        if (!active) return;
        const { data } = await layoutAPI.listByLocation(activeLocationId);
        if (!active) return;

        data.bed_layouts.forEach(layout => latestSavedBedLayouts.current.set(layout.bed, layout));
        setLayoutsByBed((prev) => {
          const next = { ...prev };
          data.bed_layouts.forEach((layout) => { next[layout.bed] = layout; });
          return next;
        });

        setLayoutsByField((prev) => {
          const next = { ...prev };
          data.field_layouts.forEach((layout) => { next[layout.field] = layout; });
          return next;
        });

        setBoundaryOriginByLocation(prev => ({ ...prev, [activeLocationId]: data.location_boundary ?? null }));
        setLayoutLoad({ locationId: activeLocationId, attempt: layoutAttempt, error: false });
      } catch (layoutError) {
        if (!active) return;
        setLayoutLoad({ locationId: activeLocationId, attempt: layoutAttempt, error: true });
        console.error("Failed to load bed layouts", layoutError);
      }
    };

    void loadLayouts();
    return () => {
      active = false;
    };
  }, [activeLocationId, layoutAttempt]);

  useEffect(() => {
    queueMicrotask(() => {
      resetTransientInteractionState();
      stopKonvaDragging();
    });
  }, [activeLocationId, editableLocationId, interactionMode]);

  const isLocationEditMode = (locationId: number): boolean =>
    globalEditMode || editableLocationId === locationId;

  const handleLocationEditToggle = (locationId: number): void => {
    setInteractionMode("view");
    setEditableLocationId((currentLocationId) =>
      currentLocationId === locationId ? null : locationId,
    );
  };

  useKeyboardShortcuts(
    [
      {
        id: "graphical-fields.toggle-edit-mode",
        title: t("fields:graphical.editMode"),
        keys: { alt: true, key: "e" },
        contexts: [],
        action: () => {
          if (showModeToggle || controlledInteractionMode !== undefined) {
            setInteractionMode(interactionMode === "edit" ? "view" : "edit");
            return;
          }
          const targetLocationId = activeLocationId;
          if (targetLocationId !== null) {
            handleLocationEditToggle(targetLocationId);
          }
        },
      },
    ],
    true,
    { currentContexts: [] },
  );

  const saveBedLayout = (locationId: number, payload: BedLayoutEntry): void => {
    setLayoutSaveErrorLocation(null);
    setLayoutsByBed(previous => ({ ...previous, [payload.bed]: payload }));
    void saveTrackedBedLayout(locationId, payload.bed, async () => {
      await layoutAPI.saveByLocation(locationId, { bed_layouts: [payload], field_layouts: [] });
      latestSavedBedLayouts.current.set(payload.bed, payload);
    }).catch((saveError: unknown) => {
      const saved = latestSavedBedLayouts.current.get(payload.bed);
      setLayoutsByBed(previous => {
        if (previous[payload.bed] !== payload) return previous;
        const restored = { ...previous };
        if (saved) restored[payload.bed] = saved;
        else delete restored[payload.bed];
        return restored;
      });
      setLayoutSaveErrorLocation(locationId);
      console.error("Failed to save bed layout", saveError);
    });
  };

  const saveFieldLayout = (
    locationId: number,
    payload: FieldLayoutEntry,
    boundaryOrigin: LocationBoundaryOrigin | null,
  ): void => {
    const previousLayout = layoutsByField[payload.field];
    setLayoutSaveErrorLocation(null);
    setLayoutsByField((prev) => ({ ...prev, [payload.field]: payload }));
    if (boundaryOrigin) {
      setBoundaryOriginByLocation((prev) => ({ ...prev, [locationId]: boundaryOrigin }));
    }
    // The first drop sets the boundary origin and the parcel position in one
    // request. Bed positions are already relative to the parcel.
    void saveTrackedFieldLayout(locationId, () => layoutAPI.saveByLocation(locationId, {
      bed_layouts: [],
      field_layouts: [payload],
      ...(boundaryOrigin && { location_boundary: boundaryOrigin }),
    })).catch((saveError: unknown) => {
      setLayoutsByField((prev) => {
        if (prev[payload.field] !== payload) return prev;
        const restored = { ...prev };
        if (previousLayout) restored[payload.field] = previousLayout;
        else delete restored[payload.field];
        return restored;
      });
      if (boundaryOrigin) {
        setBoundaryOriginByLocation((prev) => prev[locationId] === boundaryOrigin
          ? { ...prev, [locationId]: null } : prev);
      }
      setLayoutSaveErrorLocation(locationId);
      console.error("Failed to save field layout", saveError);
    });
  };

  const locationLayouts = useMemo(() => locations.flatMap(location => {
    if (!location.id) return [];
    return [getSchematicLocationLayout(
      location,
      fields.filter(field => field.location === location.id && field.id !== undefined),
      layoutsByField,
      boundaryOriginByLocation[location.id] ?? null,
      rotationByLocation[location.id] ?? DEFAULT_GRAPHICAL_ROTATION,
      stageWidth,
      stageHeight,
    )];
  }), [locations, fields, layoutsByField, boundaryOriginByLocation, rotationByLocation, stageWidth, stageHeight]);

  const bedsById = useMemo(() => new Map(beds.map(bed => [bed.id, bed])), [beds]);
  const activeLayout = locationLayouts.find(layout => layout.location.id === activeLocationId);
  const activeScene = useMemo(() => {
    if (!activeLayout) return null;
    const { location, defaultFieldRects, fieldViewModels, boundary, rotation } = activeLayout;
    const fieldRectsById = new Map(fieldViewModels.map(rect => [rect.id, rect]));
    const parcels = defaultFieldRects.flatMap<GraphicalParcel>(stored => {
      const { field } = stored;
      const rect = fieldRectsById.get(field.id!);
      if (!rect) return [];
      return [{ field, rect, layout: getGraphicalBedLayout(
        field, beds.filter(bed => bed.field === rect.id), layoutsByBed, rotation,
      ) }];
    });
    const spacing = getLocationPathSpacing(location);
    const savedGeometry = analyzeGraphicalGeometry(location, boundary, parcels, spacing, rotation, null, true);
    const bedBounds = parcels.flatMap(parcel => parcel.layout.bedRects.map(bed => getBedWorldRect(parcel, bed)));
    const contentBounds = getContentBoundsFromRects([...(boundary ? [boundary] : []), ...fieldViewModels, ...bedBounds]);
    return { parcels, fieldRectsById, spacing, savedGeometry, contentBounds };
  }, [activeLayout, beds, layoutsByBed]);
  const placementContext = useMemo(() => activeLayout && activeScene ? createGraphicPlacementContext(
    activeLayout.location, activeLayout.boundary,
    boundaryOriginByLocation[activeLayout.location.id!] ?? activeLayout.unsavedBoundaryOrigin,
    activeLayout.rotation, activeScene.parcels,
  ) : null, [activeLayout, activeScene, boundaryOriginByLocation]);
  const geometry = useMemo(() => {
    if (!activeLayout || !activeScene) return null;
    if (!geometryPreview) return activeScene.savedGeometry;
    return analyzeGraphicalGeometry(
      activeLayout.location, activeLayout.boundary, activeScene.parcels, activeScene.spacing,
      activeLayout.rotation, geometryPreview, true, activeScene.savedGeometry,
    );
  }, [activeLayout, activeScene, geometryPreview]);

  const areaObjects = useMemo(() => {
    if (!activeLayout || !activeScene || !geometry || activeLocationId === null) return new Map<string, GraphicalAreaObject>();
    const { location, boundary } = activeLayout;
    const { parcels } = activeScene;
    const locationId = activeLocationId;
    const livePreview = geometryPreview?.locationId === locationId ? geometryPreview : null;
    const locationKey = graphicalObjectKey('location', locationId);
    const model = new Map<string, GraphicalAreaObject>([[locationKey, {
      key: locationKey, type: 'location', id: locationId, name: location.name,
      metrics: location, rect: boundary, coverage: geometry.locationReport.coverage,
    }]]);
    for (const parcel of parcels) {
      const { field, rect, layout } = parcel;
      const fieldKey = graphicalObjectKey('field', rect.id);
      model.set(fieldKey, { key: fieldKey, id: rect.id, type: 'field', name: field.name,
        parent: location.name, metrics: field, rect: { ...rect, ...previewPosition(rect, livePreview, 'field') },
        coverage: geometry.parcelReports.get(rect.id)?.coverage });
      for (const bed of layout.bedRects) {
        const key = graphicalObjectKey('bed', bed.id);
        const entity = bedsById.get(bed.id);
        if (entity) model.set(key, { key, id: bed.id, type: 'bed', name: bed.name, parent: field.name,
          metrics: entity, rect: getBedWorldRect(parcel, bed, livePreview) });
      }
    }
    return model;
  }, [activeLayout, activeScene, activeLocationId, bedsById, geometry, geometryPreview]);

  const plantObjects = useMemo(() => {
    const result = new Map<string, GraphicalIndividualPlant>();
    if (!activeLayout || !activeScene) return result;
    const add = (parent: PlacementParent, dimensions: PlacementDimensions, surface: PlacementRect, rotation: GraphicalRotation) => {
      const parentPlans = plansByParent.get(graphicalObjectKey(parent.kind, parent.id)) ?? [];
      for (const projection of parentPlans) {
        const name = bedCropDisplayName(projection.crop.plan, t);
        const phase = bedCropPhaseLabel(projection.crop, t);
        for (const plant of placeIndividualPlantObjects(projection, dimensions, surface, rotation, name, phase)) {
          result.set(plant.key, plant);
        }
      }
    };
    if (activeLayout.boundary && activeLayout.location.id !== undefined) add({ kind: 'location', id: activeLayout.location.id },
      activeLayout.location, activeLayout.boundary, activeLayout.rotation);
    for (const { field, rect, layout } of activeScene.parcels) {
      const { usableArea, bedRects } = layout;
      const footprint = areaObjects.get(graphicalObjectKey('field', rect.id))?.rect;
      if (layout.pixelsPerMeter && footprint) add({ kind: 'field', id: rect.id }, field,
        { ...usableArea, x: footprint.x + usableArea.x, y: footprint.y + usableArea.y }, activeLayout.rotation);
      for (const bed of bedRects) {
        const area = areaObjects.get(graphicalObjectKey('bed', bed.id));
        const entity = bedsById.get(bed.id);
        if (area?.rect && entity) add({ kind: 'bed', id: bed.id }, entity, area.rect, bed.placementRotation);
      }
    }
    return result;
  }, [activeLayout, activeScene, areaObjects, bedsById, plansByParent, t]);
  const objectModel = useMemo(() => new Map<string, GraphicalObject>([
    ...areaObjects, ...(browseIndividualPlants ? [...plantObjects] : []),
  ]), [areaObjects, browseIndividualPlants, plantObjects]);
  const closeObjectOverlays = objects.close;
  const activePlantKey = objects.menu?.key.startsWith('plant:') ? objects.menu.key : selectedPlantKey;
  useEffect(() => {
    if (activePlantKey && !objectModel.has(activePlantKey)) queueMicrotask(closeObjectOverlays);
  }, [activePlantKey, objectModel, closeObjectOverlays]);

  const focusIndividualParent = (parent: PlacementParent) => {
    if (activeLocationId === null) return;
    const rect = objectModel.get(graphicalObjectKey(parent.kind, parent.id))?.rect;
    const bounds = rect ? getContentBoundsFromRects([rect]) : null;
    if (!bounds) return;
    const next = fitBoundsToStage(bounds, { width: stageWidth, height: stageHeight },
      getFitViewportPadding(stageWidth, stageHeight));
    setViewportByLocation(previous => ({ ...previous, [activeLocationId]: next }));
    locationCanvasRefs.current[activeLocationId]?.scrollIntoView({ block: 'nearest' });
  };

  const startTargetedIndividualPlan = useEventCallback((parent: PlacementParent) => {
    objects.close();
    setPlacementCursor(null);
    individualPlants.startDraft(parent, undefined, undefined, true);
    focusIndividualParent(parent);
  });
  const startAutomaticIndividualPlan = (reference?: PlacementParent) => {
    if (activeLocationId === null) return;
    objects.close();
    setPlacementCursor(null);
    individualPlants.startDraft(reference ?? { kind: 'location', id: activeLocationId });
  };
  const focusRequestedIndividualPlan = useEventCallback(focusIndividualParent);
  const focusedRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!individualCreationTarget || !individualSeason || !canEditIndividualPlants || loading || !layoutReady
      || layoutFailed || activeLocationId !== individualCreationTarget.locationId) return;
    startTargetedIndividualPlan(individualCreationTarget.parent);
    onIndividualCreationHandled?.();
  }, [individualCreationTarget, activeLocationId, individualSeason, canEditIndividualPlants, loading, layoutReady,
    layoutFailed, onIndividualCreationHandled, startTargetedIndividualPlan]);
  useEffect(() => {
    const { parent, planId, open } = individualPlants.editor;
    if (!requestedIndividualPlan || planId !== requestedIndividualPlan || !parent || !open || !layoutReady || layoutFailed) return;
    const request = `${activeLocationId}:${requestedIndividualPlan}:${editRequestedIndividualPlan}`;
    if (focusedRequest.current === request) return;
    focusedRequest.current = request;
    focusRequestedIndividualPlan(parent);
  }, [activeLocationId, requestedIndividualPlan, editRequestedIndividualPlan, individualPlants.editor, layoutReady, layoutFailed,
    focusRequestedIndividualPlan]);

  const getContentBoundsForLocation = (locationId: number): ContentBounds => {
    const layout = locationLayouts.find((item) => item.location.id === locationId);
    if (!layout) {
      return toContentBounds({ width: stageWidth, height: stageHeight });
    }

    const areaBounds = locationId === activeLocationId && activeScene ? activeScene.contentBounds
      : getContentBoundsFromRects(layout.boundary ? [layout.boundary, ...layout.fieldViewModels] : layout.fieldViewModels);
    return (
      areaBounds ??
      toContentBounds({
        width: layout.contentWidth,
        height: layout.contentHeight,
      })
    );
  };

  const resetViewport = (locationId: number): void => {
    objects.close();
    setViewportByLocation((prev) => {
      const contentBounds = getContentBoundsForLocation(locationId);
      const fitPadding = getFitViewportPadding(stageWidth, stageHeight);
      return {
        ...prev,
        [locationId]: fitBoundsToStage(
          contentBounds,
          { width: stageWidth, height: stageHeight },
          fitPadding,
        ),
      };
    });
  };

  const updateViewport = (
    locationId: number,
    updater: (current: ViewportState) => ViewportState,
  ): void => {
    setViewportByLocation((prev) => {
      const contentBounds = getContentBoundsForLocation(locationId);
      const fitPadding = getFitViewportPadding(stageWidth, stageHeight);
      const current =
        prev[locationId] ??
        fitBoundsToStage(
          contentBounds,
          { width: stageWidth, height: stageHeight },
          fitPadding,
        );
      const nextRaw = updater(current);
      const nextClamped = clampViewportToStage(
        nextRaw,
        contentBounds,
        { width: stageWidth, height: stageHeight },
      );
      return { ...prev, [locationId]: nextClamped };
    });
  };

  const handleZoom = (locationId: number, factor: number): void => {
    objects.close();
    updateViewport(locationId, (current) =>
      zoomAroundPoint(current, current.scale * factor, {
        x: stageWidth / 2,
        y: stageHeight / 2,
      }),
    );
  };

  const handleRotate = (locationId: number, direction: -1 | 1): void => {
    objects.close();
    stopKonvaDragging();
    resetTransientInteractionState();
    setRotationByLocation(prev => ({
      ...prev,
      [locationId]: turnRotation(prev[locationId] ?? DEFAULT_GRAPHICAL_ROTATION, direction),
    }));
    setViewportByLocation(prev => {
      const next = { ...prev };
      delete next[locationId];
      return next;
    });
  };

  const handlePanByOffset = (
    locationId: number,
    deltaX: number,
    deltaY: number,
  ): void => {
    objects.clearHover();
    updateViewport(locationId, (current) => ({
      ...current,
      x: current.x + deltaX,
      y: current.y + deltaY,
    }));
  };

  const handleStageWheel = (
    locationId: number,
    event: KonvaEventObject<WheelEvent>,
  ): void => {
    event.evt.preventDefault();
    objects.close();
    const pointer = stageRefs.current[locationId]?.getPointerPosition();
    if (!pointer) {
      return;
    }
    const direction = event.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    updateViewport(locationId, (current) =>
      zoomAroundPoint(current, current.scale * direction, pointer),
    );
  };

  const handleStageDoubleTap = (locationId: number): void => {
    if (!individualPlants.editor.placing) handleZoom(locationId, ZOOM_STEP);
  };

  const canStartPanSession = (
    event: KonvaEventObject<MouseEvent | TouchEvent>,
  ): boolean => {
    const target = event.target;
    const stage = target?.getStage?.();
    if (!stage || (target !== stage && !target.hasName("individual-placement-surface") && !objects.isObjectTarget(event))) {
      return false;
    }
    if ("button" in event.evt && event.evt.button !== 0) {
      return false;
    }
    if ("touches" in event.evt && event.evt.touches.length > 1) {
      return false;
    }
    return true;
  };

  const beginPanSession = (
    locationId: number,
    viewport: ViewportState,
    event: KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    if (!canStartPanSession(event)) {
      panSessionRef.current[locationId] = null;
      return;
    }
    const pointer = stageRefs.current[locationId]?.getPointerPosition();
    if (!pointer) {
      return;
    }
    panSessionRef.current[locationId] = startPanSession(viewport, pointer);
  };

  const continuePanSession = (
    locationId: number,
    event: KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    const session = panSessionRef.current[locationId];
    if (!session) {
      return;
    }
    const pointer = stageRefs.current[locationId]?.getPointerPosition();
    if (!pointer) {
      return;
    }
    if (Math.hypot(pointer.x - session.startPointerX, pointer.y - session.startPointerY) <= 8) return;
    objects.clearHover();
    if ("touches" in event.evt) {
      event.evt.preventDefault();
    }
    updateViewport(locationId, (current) =>
      panViewport(session, pointer, current.scale),
    );
  };

  const endPanSession = (locationId: number): void => {
    panSessionRef.current[locationId] = null;
  };

  const handleStageTouchMove = (
    locationId: number,
    event: KonvaEventObject<TouchEvent>,
  ): void => {
    const stage = stageRefs.current[locationId];
    const touches = event.evt.touches;
    if (!stage) {
      return;
    }

    if (touches.length === 1) {
      pinchStateRef.current[locationId] = null;
      if (!panSessionRef.current[locationId]) return;
      continuePanSession(locationId, event);
      return;
    }

    if (touches.length !== 2) {
      pinchStateRef.current[locationId] = null;
      endPanSession(locationId);
      return;
    }

    endPanSession(locationId);
    event.evt.preventDefault();
    const first = touches[0];
    const second = touches[1];
    const center = {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    };
    const distance = Math.hypot(
      second.clientX - first.clientX,
      second.clientY - first.clientY,
    );
    const lastPinch = pinchStateRef.current[locationId];

    if (!lastPinch) {
      pinchStateRef.current[locationId] = { center, distance };
      return;
    }

    const scaleFactor = distance / Math.max(lastPinch.distance, 1);
    updateViewport(locationId, (current) => {
      const zoomed = zoomAroundPoint(
        current,
        current.scale * scaleFactor,
        center,
      );
      return {
        ...zoomed,
        x: zoomed.x + (center.x - lastPinch.center.x),
        y: zoomed.y + (center.y - lastPinch.center.y),
      };
    });

    pinchStateRef.current[locationId] = { center, distance };
  };

  const handleStageMouseDown = (
    locationId: number,
    viewport: ViewportState,
    event: KonvaEventObject<MouseEvent>,
  ): void => {
    objects.beginStage(event);
    beginPanSession(locationId, viewport, event);
  };

  const handleStageMouseMove = (
    locationId: number,
    event: KonvaEventObject<MouseEvent>,
  ): void => {
    objects.moveStage(event);
    continuePanSession(locationId, event);
  };

  const handleStageMouseUp = (locationId: number): void => {
    endPanSession(locationId);
  };

  const handleStageTouchStart = (
    locationId: number,
    viewport: ViewportState,
    event: KonvaEventObject<TouchEvent>,
  ): void => {
    const touches = event.evt.touches;
    objects.beginStage(event);
    if (touches.length === 1) {
      beginPanSession(locationId, viewport, event);
      return;
    }
    if (touches.length === 2) {
      objects.close();
      endPanSession(locationId);
      stopKonvaDragging();
    }
  };

  const getFieldInteractionProps = (
    fieldId: number,
    currentFieldRect: RectViewModel,
    contentBounds: { width: number; height: number },
    fieldViewModels: RectViewModel[],
    locationId: number,
    rotation: GraphicalRotation,
    boundary: PlacementRect | null,
    unsavedBoundaryOrigin: LocationBoundaryOrigin | null,
    snapping: DragSnapping,
  ): KonvaNodeEvents & { draggable: boolean } => {
    if (!isLocationEditMode(locationId)) return { draggable: false };

    // Plots stay on the workspace and, when the location has a boundary,
    // inside it; plots without a boundary keep the workspace-only clamp.
    const constrain = (position: Point): Point => {
      const onWorkspace = clampInsideParent(position, currentFieldRect, contentBounds);
      return boundary ? clampInsideBoundary(onWorkspace, currentFieldRect, boundary) : onWorkspace;
    };

    const drag: AreaDragOptions = {
      area: currentFieldRect,
      neighbors: fieldViewModels,
      snapping,
      constrain,
      blocked: () => hasPendingFieldLayout(locationId),
      onGuides: setActiveGuides,
      onPreview: position => setGeometryPreview(position && { type: "field", id: fieldId, locationId, position }),
      onDrop: position => {
        const inverseRotation = ((360 - rotation) % 360) as GraphicalRotation;
        const stored = rotateRect({ ...currentFieldRect, ...position }, contentBounds, inverseRotation);
        saveFieldLayout(locationId, {
          field: fieldId, location: locationId, x: stored.x, y: stored.y, version: 1,
        }, unsavedBoundaryOrigin);
      },
    };
    return {
      draggable: true,
      onDragMove: event => areaDrag.move(event, drag),
      onDragEnd: event => areaDrag.end(event, drag),
    };
  };

  const getBedInteractionProps = (
    bedVm: BedViewModel,
    currentFieldRect: RectViewModel,
    fieldInnerSize: PlacementRect,
    bedViewModels: BedViewModel[],
    locationId: number,
    storedFieldInnerSize: RectSize,
    rotation: GraphicalRotation,
    snapping: DragSnapping,
  ): KonvaNodeEvents & { draggable: boolean } => {
    if (!isLocationEditMode(locationId)) return { draggable: false };

    const drag: AreaDragOptions = {
      area: bedVm,
      neighbors: bedViewModels,
      snapping,
      constrain: position => clampInsideParent(position, bedVm, fieldInnerSize),
      offset: fieldInnerSize,
      onPreview: position => setGeometryPreview(position && { type: "bed", id: bedVm.id, locationId, position }),
      onGuides: guides => setActiveGuides(guides.map(guide => {
        const x = currentFieldRect.x + fieldInnerSize.x;
        const y = currentFieldRect.y + fieldInnerSize.y;
        const vertical = guide.orientation === "vertical";
        return {
          ...guide,
          value: guide.value + (vertical ? x : y),
          start: guide.start + (vertical ? y : x),
          end: guide.end + (vertical ? y : x),
        };
      })),
      onDrop: position => {
        const inverseRotation = ((360 - rotation) % 360) as GraphicalRotation;
        const stored = rotateRectBetweenSizes({ ...bedVm, ...position }, fieldInnerSize, storedFieldInnerSize, inverseRotation);
        const nextLayout: BedLayoutEntry = {
          ...layoutsByBed[bedVm.id], bed: bedVm.id, location: locationId, x: stored.x, y: stored.y, version: 1,
        };
        saveBedLayout(locationId, nextLayout);
      },
    };
    return {
      draggable: true,
      onDragMove: event => areaDrag.move(event, drag),
      onDragEnd: event => areaDrag.end(event, drag),
    };
  };

  const handleStageTouchEnd = (locationId: number): void => {
    endPanSession(locationId);
    pinchStateRef.current[locationId] = null;
  };

  const effectiveActivePanLocationId = activeLocationId;

  useEffect(() => {
    if (!layoutReady || layoutFailed) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (event.defaultPrevented || target?.closest('[role="menu"], [role="listbox"], [aria-modal="true"]')
        || isTypingInEditableElement(target) || effectiveActivePanLocationId === null) {
        return;
      }
      const step = event.shiftKey ? PAN_FAST_STEP : PAN_STEP;
      switch (event.key) {
        case "Shift":
          areaDrag.preview(true);
          break;
        case "Escape":
          if (stageRefs.current[effectiveActivePanLocationId]?.find?.(".graphical-editable")
            .some(node => node.isDragging())) {
            event.preventDefault();
            stopKonvaDragging();
          } else if (individualPlants.editor.placing) {
            event.preventDefault();
            individualPlants.update({ placing: null });
          }
          break;
        case "ArrowUp":
          event.preventDefault();
          handlePanByOffset(effectiveActivePanLocationId, 0, step);
          break;
        case "ArrowDown":
          event.preventDefault();
          handlePanByOffset(effectiveActivePanLocationId, 0, -step);
          break;
        case "ArrowLeft":
          event.preventDefault();
          handlePanByOffset(effectiveActivePanLocationId, step, 0);
          break;
        case "ArrowRight":
          event.preventDefault();
          handlePanByOffset(effectiveActivePanLocationId, -step, 0);
          break;
        default:
          break;
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key === "Shift" && !event.shiftKey) areaDrag.preview(false);
    };
    const captureEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleKeyDown(event);
    };
    window.addEventListener("keydown", captureEscape, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", captureEscape, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [areaDrag, effectiveActivePanLocationId, handlePanByOffset, individualPlants, layoutFailed, layoutReady]);

  if (loading || !layoutReady) {
    return (
      <Box sx={{ p: { xs: 0, sm: 3 } }}>
        <CircularProgress />
      </Box>
    );
  }

  if (layoutFailed) {
    return <Alert severity="error" action={<LoadRetryButton onClick={() => setLayoutAttempt(attempt => attempt + 1)} />}>
      {t('fields:graphical.layoutLoadError')}
    </Alert>;
  }

  return (
    <Box
      ref={containerRef}
      sx={{ minWidth: 0 }}
    >
      {showTitle || showModeToggle ? <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{ mb: 2,
        justifyContent: "space-between",
        alignItems: { xs: "stretch", sm: "center" }, }}

        spacing={2}
      >
        <Box>
          {showTitle ? (
            <Typography variant="h4" gutterBottom>
              {t("fields:graphical.title")}
            </Typography>
          ) : null}
        </Box>
        {showModeToggle ? (
          <Stack spacing={0.5} sx={{ width: { xs: "100%", sm: "auto" } }}>
            <ModeToggle
              label={t("fields:graphical.viewMode")}
              ariaLabel={t("fields:graphical.modeAriaLabel")}
              viewLabel={t("fields:graphical.viewModeOption")}
              editLabel={t("fields:graphical.editModeOption")}
              value={interactionMode}
              onChange={setInteractionMode}
            />
          </Stack>
        ) : null}
      </Stack> : null}

      {error ? <Alert severity="error">{error}</Alert> : null}

      {locationLayouts.filter(layout => layout.location.id === activeLocationId).map(
        ({
          location,
          fieldViewModels,
          boundary,
          unsavedBoundaryOrigin,
          contentWidth,
          contentHeight,
          rotation,
        }) => {
          if (!location.id || !activeScene || !geometry) return null;
          const locationId = location.id;
          const { parcels, fieldRectsById, spacing: pathSpacing } = activeScene;
          const locationCoverage = geometry.locationReport.coverage;
          const parcelWarnings = getGeometryOutlines(geometry.locationReport.issues);
          const fieldsOutsideBoundary = new Set(geometry.locationReport.issues.flatMap(issue => issue.kind === "outside" ? [issue.id] : []));
          if (boundary) {
            for (const id of geometry.locationReport.uncertainIds) {
              const rect = fieldRectsById.get(id);
              const preview = geometryPreview?.type === "field" && geometryPreview.id === id
                && geometryPreview.locationId === locationId ? geometryPreview.position : null;
              if (rect && isRectOutsideBoundary(preview ? { ...rect, ...preview } : rect, boundary)) {
                fieldsOutsideBoundary.add(id);
                parcelWarnings.set(id, "outside");
              }
            }
          }
          const bedWarnings = new Map<number, OutlineKind>();
          for (const { rect } of parcels) {
            const issues = geometry.parcelReports.get(rect.id)?.issues ?? [];
            if (!parcelWarnings.has(rect.id) && issues.some(issue => issue.kind === 'noPathSpace')) {
              parcelWarnings.set(rect.id, 'shortGap');
            }
            for (const [id, kind] of getGeometryOutlines(issues)) bedWarnings.set(id, kind);
          }
          const contentBounds = getContentBoundsForLocation(locationId);
          const locationIsEditable = isLocationEditMode(locationId);
          const showIndividualPanel = individualSeason && individualPlants.editor.open && !locationIsEditable
            && fullscreenLocationId !== locationId;
          const stemDraft = showIndividualPanel ? individualPlants.editor.draft : null;
          const localPlacement = !placementContext && stemDraft
            ? createParentLocalPlacement(stemDraft.parent, parcels, rotation) : null;
          const draftPlacement = placementContext ?? localPlacement;
          const placingStems = Boolean(stemDraft && individualSeason && draftPlacement && individualPlants.editor.placing
            && readyForPlacement(stemDraft, individualSeason));
          const cursorPoint = placementCursor?.location === locationId ? placementCursor.point : null;
          const placementPreview = placingStems && cursorPoint ? draftPlacement?.resolveWorld(cursorPoint) ?? null : null;
          const previewPlacement = (point: Point | null) => setPlacementCursor(point && { location: locationId, point });
          const addStemAt = (point: Point) => {
            previewPlacement(point);
            const resolution = draftPlacement?.resolveWorld(point);
            if (resolution && 'local' in resolution) individualPlants.addStem({ ...resolution.local, graphic: resolution.point });
          };
          const keyboardPlacement = (direction: Point | null) => {
            const surface = localPlacement?.surface ?? boundary;
            if (!surface) return;
            const start = cursorPoint ?? { x: surface.x + surface.width / 2, y: surface.y + surface.height / 2 };
            if (direction) previewPlacement({ x: start.x + direction.x * FIELD_WORLD_PX_PER_METER / 2,
              y: start.y + direction.y * FIELD_WORLD_PX_PER_METER / 2 });
            else addStemAt(start);
          };
          const renderedPlantPlans = [...plansByParent].flatMap(([key, plans]) => {
            const area = areaObjects.get(key);
            if (!area?.rect || !parcelMeters(area.metrics)) return [];
            return plans.filter(({ plan }) => plan.id !== stemDraft?.planId && plan.individual_positions?.length);
          });
          const hasDraftStems = Boolean(stemDraft?.stems.length);
          const hasCanopies = (hasDraftStems && Number(stemDraft?.canopy ?? 0) > 0)
            || renderedPlantPlans.some(({ plan }) => Number(plan.estimated_canopy_diameter_m ?? 0) > 0);
          // In graphic edit mode a placed stem is its own drag target, above beds and parcels (#1579).
          const draggableStemPlans = locationIsEditable ? getDirectlyDraggableStemPlans(individualPlants) : undefined;
          const viewport =
            viewportByLocation[locationId] ??
            fitBoundsToStage(
              contentBounds,
              { width: stageWidth, height: stageHeight },
              getFitViewportPadding(stageWidth, stageHeight),
            );
          const visibility = getVisibleElements(viewport.scale);
          const locationKey = graphicalObjectKey('location', locationId);
          const details = (object: GraphicalObject) => {
            if (object.type === 'plant') onOpenIndividualPlan?.(object.id);
            else onOpenDetails?.(object.type, object.id);
          };
          const overlayKey = objects.menu?.key ?? objects.selection;
          const highlight = overlayKey ? areaObjects.get(overlayKey)?.rect : null;
          const plantLabels = browseIndividualPlants && showCrops && plantObjects.size
            ? getIndividualPlantLabels([...plantObjects.values()], [...areaObjects.values()].flatMap(object =>
              object.type === 'bed' && object.rect ? [object.rect] : []), viewport,
              { width: stageWidth, height: stageHeight }, measureText.plant) : null;
          const viewportSize = { width: stageWidth, height: stageHeight };
          const projectedBoundary = boundary && projectViewportRect(boundary, viewport);
          const showFallbackLocationLabel = !projectedBoundary
            || !rectsOverlap(projectedBoundary, { x: 0, y: 0, ...viewportSize });
          const locationLabel = boundary ? t("fields:graphical.locationBoundaryLabel", {
            name: location.name,
            width: formatLocalizedNumber(location.width_m ?? 0, getActiveFormattingLocale(), { maximumFractionDigits: 2 }),
            length: formatLocalizedNumber(location.length_m ?? 0, getActiveFormattingLocale(), { maximumFractionDigits: 2 }),
          }) : '';
          const movingStem = draggedStem?.location === locationId ? draggedStem : null;
          const annotations = (() => {
            if (!annotationOverlays) return [];
            const project = (rect: PlacementRect) => projectViewportRect(rect, viewport);
            const obstacles: AreaAnnotationObstacle[] = annotationOverlays.map(rect => ({ rect }));
            const subjects: AreaAnnotationSubject[] = [];
            const bedRotations = new Map<number, GraphicalRotation>();
            if (boundary && projectedBoundary) {
              const footprint = projectedBoundary;
              const { x, y, width, height } = footprint;
              const siteEdges = [
                { x, y: y - 1, width, height: 2 }, { x, y: y + height - 1, width, height: 2 },
                { x: x - 1, y, width: 2, height }, { x: x + width - 1, y, width: 2, height },
              ];
              obstacles.push(...siteEdges.map(rect => ({ rect, owner: locationKey })));
              subjects.push({
                key: locationKey, testId: `location-boundary-label-${locationId}`, kind: 'location',
                text: locationLabel, textWidth: measureText.location(locationLabel), footprint,
                gaps: getGraphicalFreeRects(locationCoverage, boundary,
                  { x: FIELD_WORLD_PX_PER_METER, y: FIELD_WORLD_PX_PER_METER }).map(project),
              });
            }
            for (const { field, rect, layout } of parcels) {
              const key = graphicalObjectKey('field', rect.id);
              const area = areaObjects.get(key);
              if (!area?.rect) continue;
              const footprint = project(area.rect);
              const { usableArea, pixelsPerMeter } = layout;
              for (const bed of layout.bedRects) bedRotations.set(bed.id, bed.placementRotation);
              obstacles.push({ rect: footprint, owner: key });
              subjects.push({
                key, testId: `field-label-${rect.id}`, kind: 'field', text: field.name,
                textWidth: measureText.parcel(field.name), footprint,
                gaps: pixelsPerMeter ? getGraphicalFreeRects(area.coverage,
                  { x: area.rect.x + usableArea.x, y: area.rect.y + usableArea.y }, pixelsPerMeter).map(project) : [],
              });
            }
            for (const { type, rect } of areaObjects.values()) {
              // Bed names, crop rows and task indicators are drawn within their bed footprints.
              if (type === 'bed' && rect) obstacles.push({ rect: project(rect) });
            }
            const reserveStem = (world: Point, stemId?: string) => {
              const point = project({ ...world, width: 0, height: 0 });
              obstacles.push({ rect: { x: point.x - 8, y: point.y - 8, width: 16, height: 16 } });
              const label = stemId ? plantLabels?.get(stemId) : undefined;
              if (label) obstacles.push({ rect: { ...label, x: point.x + label.x, y: point.y + label.y } });
            };
            for (const plant of plantObjects.values()) {
              if (plant.plan.id !== stemDraft?.planId) {
                reserveStem(movingStem?.key === plant.stemId ? movingStem.point : plant.rect, plant.stemId);
              }
            }
            if (stemDraft) for (const stem of stemDraft.stems) {
              const parent = stem.graphic?.parent ?? stemDraft.parent;
              const area = areaObjects.get(graphicalObjectKey(parent.kind, parent.id));
              if (!area?.rect) continue;
              const bedRotation = parent.kind === 'bed' ? bedRotations.get(parent.id) : undefined;
              const point = movingStem?.key === stem.key ? movingStem.point
                : stemToCanvas(stem, area.metrics, area.rect, bedRotation ?? rotation);
              if (point) reserveStem(point);
            }
            return layoutAreaAnnotations(subjects, obstacles, viewportSize);
          })();
          const snapping = { enabled: pathSpacing.snap_to_path_spacing, zoom: viewport.scale };
          const focusArea = (rect: PlacementRect): void => {
            setViewportByLocation(previous => ({ ...previous, [locationId]: {
              scale: viewport.scale,
              x: stageWidth / 2 - (rect.x + rect.width / 2) * viewport.scale,
              y: stageHeight / 2 - (rect.y + rect.height / 2) * viewport.scale,
            } }));
          };
          const canEditPlant = (plant: GraphicalIndividualPlant) => individualPlants.canEdit && Boolean(plant.plan.updated_at)
            && !individualPlants.editor.draft && !individualPlants.movingPlans.has(plant.id);
          const editPlant = (plant: GraphicalIndividualPlant, action: IndividualPlacementAction) => {
            if (!canEditPlant(plant)) return;
            const start = () => {
              objects.close();
              individualPlants.startDraft(plant.parent, plant.plan, { action, stemId: plant.stemId });
              focusIndividualParent(plant.parent);
            };
            if (fullscreenLocationId === locationId) void toggleFullscreen(locationId).then(start);
            else start();
          };
          const renderPlacement = (parent: PlacementParent, dimensions: PlacementDimensions, surface: PlacementRect,
            placementRotation: GraphicalRotation) => {
            if (!parcelMeters(dimensions)) return null;
            const draft = matchesPlacementParent(stemDraft?.parent, parent) ? stemDraft : null;
            const parentPlans = plansByParent.get(graphicalObjectKey(parent.kind, parent.id)) ?? [];
            const stems: CanvasStem[] = parentPlans.flatMap(({ plan, crop, cropProjected }) => {
              if (plan.id === draft?.planId) return [];
              const summary = showTasks && !locationIsEditable ? plantTaskSummaries.get(plan.id) : undefined;
              const urgency = summary?.outstanding ? summary.urgency ?? undefined : undefined;
              const phase = showCrops && !locationIsEditable ? crop.phase : undefined;
              const phaseColor = phase && !showTasks ? graphicalCropPhaseColor(theme, phase, crop.plan.color) : undefined;
              const neutralCrop = !locationIsEditable && plantCropReference !== undefined
                && (!cropProjected || (plantCropReference.kind === 'range' && !phase));
              return (plan.individual_positions ?? []).map(stem => {
                const key = individualPlantObjectKey(stem.id);
                const object = plantObjects.get(key);
                const label = plantLabels?.get(stem.id);
                return { ...stem, key: stem.id, planId: plan.id, phase, phaseColor, urgency, neutralCrop,
                  objectKey: browseIndividualPlants ? object?.key : undefined, canopy: Number(plan.estimated_canopy_diameter_m ?? 0),
                  label: label && object ? { ...label, name: object.name, phase: object.phase } : undefined,
                  selected: key === overlayKey || Boolean(showIndividualPanel) && stem.id === individualPlants.editor.selectedKey };
              });
            });
            const added = stemDraft?.stems.filter(stem => matchesPlacementParent(stem.graphic?.parent ?? stemDraft.parent, parent)) ?? [];
            stems.push(...added.map(stem => ({ ...stem, planId: stemDraft?.planId ?? null,
              canopy: Number(stemDraft?.canopy ?? 0), selected: stem.key === individualPlants.editor.selectedKey })));
            if (!stems.length) return null;
            return <GraphicalIndividualPlantsLayer field={dimensions} surface={surface}
              rotation={placementRotation} zoom={viewport.scale} stems={stems}
              editablePlanId={(draft || added.length) && !individualPlants.editor.saving && !placingStems
                ? stemDraft?.planId ?? null : undefined}
              draggablePlanIds={draggableStemPlans}
              captureStems={locationIsEditable && individualPlants.canEdit}
              onDragPreview={(key, point) => setDraggedStem(point && { location: locationId, key, point })}
              onMoveWorld={placementContext ? (key, world) => {
                const plan = individualPlants.plans.find(item => item.individual_positions?.some(stem => stem.id === key));
                if (!plan?.id) return;
                const resolution = placementContext.resolveWorld(world);
                if ('error' in resolution) individualPlants.reportMoveError(resolution.error);
                else void individualPlants.moveSavedStem(plan.id, key, resolution.local, { scene: placementContext.scene, point: resolution.point });
              } : undefined}
              onMove={(key, position) => {
                const editingStem = added.find(stem => stem.key === key);
                if (editingStem) {
                  if (!editingStem.graphic) individualPlants.changeStem(key, position);
                  else {
                    const result = placementContext?.resolveLocal(parent, position);
                    if (result && 'local' in result) {
                      individualPlants.changeStem(key, { ...result.local, graphic: result.point });
                    } else if (result) individualPlants.update({ error: result.error });
                  }
                  return;
                }
                const plan = individualPlants.plans.find(item => item.individual_positions?.some(stem => stem.id === key));
                if (plan?.id) void individualPlants.moveSavedStem(plan.id, key, position);
              }}
              onSelect={draft && !locationIsEditable && fullscreenLocationId !== locationId
                ? stem => individualPlants.select(stem.planId, parent, stem.key) : undefined} />;
          };

          return (
            <Box key={locationId} role="region" aria-label={t("fields:graphical.locationTitle", { name: location.name })}>
                {locationIsEditable && individualPlants.moveError ? (
                  <Alert severity="error" sx={{ mb: 1.5 }}>{t(`fields:individualPlants.${individualPlants.moveError}`)}</Alert>
                ) : null}
                {layoutSaveErrorLocation === locationId ? (
                  <Alert severity="error" sx={{ mb: 1.5 }}>{t("fields:errors.save")}</Alert>
                ) : null}
                <Box sx={{
                  display: "grid", alignItems: "start", gap: showIndividualPanel ? 1.5 : 0,
                  gridTemplateColumns: { xs: "minmax(0, 1fr)", md: showIndividualPanel ? "minmax(0, 1fr) 324px" : "minmax(0, 1fr)" },
                }}>
                <Box
                  ref={(node: HTMLDivElement | null) => {
                    locationCanvasRefs.current[locationId] = node;
                    activeCanvasRef.current = node;
                  }}
                  sx={{
                    width: "100%",
                    overflow: "hidden",
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                    '& .konvajs-content': { touchAction: 'none' },
                    position: "relative",
                    bgcolor: "background.paper",
                    height:
                      fullscreenLocationId === locationId
                        ? "100vh"
                        : undefined,
                  }}
                >
                  <GraphicalCanvasTools key={activeSeasonId ?? 'no-season'}
                    width={stageWidth} height={stageHeight} fullscreen={fullscreenLocationId === locationId}
                    onTriggerChange={button => { canvasToolsRefs.current[locationId] = button; }}
                    onZoom={direction => handleZoom(locationId, direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP)}
                    onFit={() => resetViewport(locationId)}
                    onFullscreen={() => { objects.close(); void toggleFullscreen(locationId); }}
                    onRotate={direction => handleRotate(locationId, direction)}
                    onPan={direction => {
                      const [dx, dy] = canvasPanOffsets[direction];
                      handlePanByOffset(locationId, dx, dy);
                    }}
                    warnings={<GraphicalGeometryWarnings t={t} parcels={parcels} analysis={geometry}
                      outsideParcels={fieldsOutsideBoundary} focusArea={focusArea} />}
                    individualPlants={individualSeason && !locationIsEditable && fullscreenLocationId !== locationId ? {
                      active: Boolean(showIndividualPanel),
                      toggle: () => individualPlants.update({ open: !showIndividualPanel, placing: null }),
                      add: individualPlants.canEdit && !individualPlants.editor.draft ? () => startAutomaticIndividualPlan() : undefined,
                    } : undefined}
                  />
                  {fullscreenLocationId === locationId && fullscreenDisplayControls && (
                    <Box data-graphical-annotation-obstacle sx={{ position: 'absolute', zIndex: 2, top: 12, left: 105,
                      right: { xs: 64, sm: 110 }, width: 'fit-content', bgcolor: 'background.paper' }}>
                      {fullscreenDisplayControls}
                    </Box>
                  )}
                  {!locationIsEditable && ((showCrops && (locationPlans.loading || locationPlans.failed))
                    || (showTasks && (bedTasks.loading || bedTasks.failed))) && (
                    <Stack data-graphical-annotation-obstacle sx={{ position: 'absolute', zIndex: 2, left: 12, right: 110, top: 54,
                      width: 'fit-content', maxWidth: 'calc(100% - 122px)' }}>
                      {showCrops && locationPlans.failed && <Alert severity="error"
                        action={<LoadRetryButton onClick={locationPlans.refresh} />}>
                        {t('fields:graphical.display.cropLoadError')}
                      </Alert>}
                      {showTasks && bedTasks.failed && (!showCrops || !locationPlans.failed) && <Alert severity="error" action={<LoadRetryButton onClick={bedTasks.refresh} />}>
                        {t('fields:graphical.taskLayer.loadError')}
                      </Alert>}
                      {((showCrops && locationPlans.loading) || (showTasks && bedTasks.loading)) && (
                        <Typography role="status" variant="caption" sx={{ bgcolor: 'background.paper', p: 0.5 }}>
                          {t('common:messages.loading')}
                        </Typography>
                      )}
                    </Stack>
                  )}
                  <Typography
                    data-graphical-annotation-obstacle
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      position: "absolute",
                      left: 12,
                      top: 12,
                      zIndex: 2,
                      px: 1,
                      py: 0.5,
                      borderRadius: 2,
                      bgcolor: (theme) => alpha(theme.palette.common.white, 0.78),
                      backdropFilter: "blur(2px)",
                    }}
                  >
                    {t("fields:graphical.zoomLevel", {
                      value: viewport.scale.toFixed(2),
                    })}
                  </Typography>
                  <Stage
                    key={`stage-${locationId}-${interactionMode}-${locationIsEditable ? "edit" : "view"}`}
                    width={stageWidth}
                    height={stageHeight}
                    draggable={false}
                    x={viewport.x}
                    y={viewport.y}
                    scaleX={viewport.scale}
                    scaleY={viewport.scale}
                    onMouseDown={(event) =>
                      handleStageMouseDown(locationId, viewport, event)
                    }
                    onMouseMove={(event) =>
                      handleStageMouseMove(locationId, event)
                    }
                    onMouseUp={() => handleStageMouseUp(locationId)}
                    onMouseLeave={() => {
                      handleStageMouseUp(locationId);
                      objects.cancelPress();
                      objects.clearHover();
                    }}
                    onClick={objects.releaseStage}
                    onTap={objects.releaseStage}
                    onContextMenu={objects.contextStage}
                    onWheel={(event) => handleStageWheel(locationId, event)}
                    onDblTap={() => {
                      // A finished long press must not also trigger Konva's double-tap zoom.
                      if (!objects.didLongPress()) handleStageDoubleTap(locationId);
                    }}
                    onDblClick={() => handleStageDoubleTap(locationId)}
                    onTouchStart={(event) =>
                      handleStageTouchStart(locationId, viewport, event)
                    }
                    onTouchMove={(event) => {
                      objects.moveStage(event);
                      handleStageTouchMove(locationId, event);
                    }}
                    onTouchEnd={event => {
                      objects.endTouch(event.evt);
                      handleStageTouchEnd(locationId);
                    }}
                    onTouchCancel={event => {
                      objects.endTouch(event.evt);
                      objects.cancelPress();
                      handleStageTouchEnd(locationId);
                    }}
                    ref={(node) => {
                      stageRefs.current[locationId] = node;
                    }}
                  >
                    <Layer>
                      {boundary ? (
                        <Group>
                          <GraphicalFreeRectangles coverage={locationCoverage} origin={boundary}
                            scale={{ x: FIELD_WORLD_PX_PER_METER, y: FIELD_WORLD_PX_PER_METER }} kind="site"
                            objectKey={objectInteractionEnabled ? locationKey : undefined} />
                          <Rect
                            {...boundary}
                            stroke={theme.palette.text.secondary}
                            strokeWidth={2}
                            strokeScaleEnabled={false}
                            dash={[8, 6]}
                            listening={objectInteractionEnabled}
                            hitStrokeWidth={8 / viewport.scale}
                            data-graphical-object-key={locationKey}
                            data-testid={`location-boundary-${locationId}`}
                          />
                        </Group>
                      ) : null}
                      {parcels.map(({ field, rect: currentFieldRect, layout }) => {
                        const fieldId = currentFieldRect.id;
                        const { usableArea: fieldUsableArea, storedUsableArea, pixelsPerMeter, bedRects } = layout;
                        const parcelReport = geometry.parcelReports.get(fieldId);
                        const bedSpacing = pixelsPerMeter
                          ? { centimeters: pathSpacing.bed_path_spacing_cm, pixelsPerMeter }
                          : undefined;
                        const fieldWarning = parcelWarnings.get(fieldId);
                        const fieldDragProps = getFieldInteractionProps(
                          fieldId, currentFieldRect,
                          { width: contentWidth, height: contentHeight },
                          fieldViewModels, locationId, rotation, boundary, unsavedBoundaryOrigin,
                          { ...snapping, thresholdPx: FIELD_SNAP_THRESHOLD, spacing: {
                            centimeters: pathSpacing.parcel_path_spacing_cm,
                            pixelsPerMeter: { x: FIELD_WORLD_PX_PER_METER, y: FIELD_WORLD_PX_PER_METER },
                          } },
                        );
                        return (
                          <Group
                            key={fieldId}
                            x={currentFieldRect.x}
                            y={currentFieldRect.y}
                            name="graphical-editable"
                            data-testid={`field-group-${fieldId}`}
                            {...fieldDragProps}
                          >
                            <Rect
                              x={fieldUsableArea.x}
                              y={fieldUsableArea.y}
                              width={fieldUsableArea.width}
                              height={fieldUsableArea.height}
                              fill={theme.palette.background.paper}
                              listening={objectInteractionEnabled || locationIsEditable}
                              data-graphical-object-key={graphicalObjectKey('field', fieldId)}
                              data-testid={`field-usable-area-${fieldId}`}
                            />
                            {pixelsPerMeter ? <GraphicalFreeRectangles coverage={parcelReport?.coverage}
                              origin={fieldUsableArea} scale={pixelsPerMeter} kind="parcel" /> : null}
                            <Rect
                              width={currentFieldRect.width}
                              height={currentFieldRect.height}
                              dash={pixelsPerMeter ? undefined : [6, 4]}
                              {...getOutlineProps(fieldWarning, theme.palette.primary.main, 2)}
                              data-geometry-issue={fieldWarning}
                              data-testid={`field-rect-${fieldId}`}
                              data-outside-location={fieldsOutsideBoundary.has(fieldId) || undefined}
                              data-graphical-object-key={graphicalObjectKey('field', fieldId)}
                            />
                            {bedRects.filter(bedVm => visibility.showBeds
                              || matchesPlacementParent(stemDraft?.parent, { kind: 'bed', id: bedVm.id })
                              || plansByParent.has(graphicalObjectKey('bed', bedVm.id))
                            ).map((bedVm) => {
                                const shownMode = locationIsEditable ? 'areas' : displayMode;
                                const entries = showCrops && !locationIsEditable ? cropsByBed.get(bedVm.id) ?? [] : [];
                                const tasks = showTasks && !locationIsEditable ? openTasksByBed.get(bedVm.id) ?? [] : [];
                                const urgency = tasks.length ? taskSummaries.get(bedVm.id)?.urgency : undefined;
                                const taskColors = urgency ? bedTaskColors(theme, urgency) : null;
                                const phase = entries.length === 1 ? entries[0].phase : null;
                                const cropFill = entries.length ? graphicalBedCropFill(theme, phase, entries[0].plan.color) : undefined;
                                const fill = includesTasks(shownMode) ? taskColors?.fill : cropFill;
                                const bed = bedsById.get(bedVm.id);
                                return (
                                  <Group key={bedVm.id} name="graphical-editable" data-testid={`bed-group-${bedVm.id}`}
                                    x={fieldUsableArea.x + bedVm.x} y={fieldUsableArea.y + bedVm.y}
                                    {...getBedInteractionProps(
                                      bedVm, currentFieldRect, fieldUsableArea, bedRects, locationId, storedUsableArea,
                                      rotation, { ...snapping, thresholdPx: SNAP_THRESHOLD, spacing: bedSpacing },
                                    )}>
                                    <Rect
                                      width={bedVm.width}
                                      height={bedVm.height}
                                      fill={fill ?? theme.palette.info.light}
                                      dash={bedVm.supportsMetricSpacing ? undefined : [6, 4]}
                                      {...getOutlineProps(bedWarnings.get(bedVm.id), theme.palette.info.main, 1)}
                                      data-geometry-issue={bedWarnings.get(bedVm.id)}
                                      data-task-urgency={urgency}
                                      data-crop-phase={phase ?? (entries.length > 1 ? 'mixed' : undefined)}
                                      data-testid={`bed-rect-${bedVm.id}`}
                                      data-graphical-object-key={graphicalObjectKey('bed', bedVm.id)}
                                    />
                                    {visibility.showBedLabels && <GraphicalBedLabels bed={bedVm} scale={viewport.scale}
                                      mode={shownMode} detailedArea={visibility.showDetailedBedLabels}
                                      crops={entries} tasks={tasks} urgency={urgency} />}
                                    {bed && renderPlacement({ kind: 'bed', id: bedVm.id }, bed,
                                      { x: 0, y: 0, width: bedVm.width, height: bedVm.height }, bedVm.placementRotation)}
                                  </Group>
                                );
                              })}
                            {pixelsPerMeter && renderPlacement({ kind: 'field', id: fieldId }, field, fieldUsableArea, rotation)}
                          </Group>
                        );
                      })}
                      {boundary && renderPlacement({ kind: 'location', id: locationId }, location, boundary, rotation)}
                      {placingStems && <GraphicalFreePlantPlacement viewport={viewport} size={{ width: stageWidth, height: stageHeight }}
                        surface={localPlacement?.surface} point={cursorPoint} preview={placementPreview}
                        onPreview={previewPlacement} onPlace={addStemAt} />}

                      {highlight && <Rect {...highlight} listening={false} cornerRadius={3} strokeWidth={3}
                        strokeScaleEnabled={false} stroke={theme.palette.success.dark}
                        data-testid="graphical-object-highlight" />}
                      <GraphicalSnapGuides guides={activeGuides} scale={viewport.scale} />
                    </Layer>
                    <GraphicalAreaAnnotations labels={annotations} viewport={viewport} />
                  </Stage>
                  <GraphicalDisplayLegend
                    mode={locationIsEditable ? 'areas' : displayMode}
                    compact={stageWidth < theme.breakpoints.values.md}
                    hasBoundary={Boolean(boundary)}
                    freeSite={Boolean(boundary && locationCoverage.freeRects?.length)}
                    freeParcel={parcels.some(({ rect, layout }) => layout.pixelsPerMeter
                      && geometry.parcelReports.get(rect.id)?.coverage.freeRects?.length)}
                    geometryOutlines={new Set([...parcelWarnings.values(), ...bedWarnings.values()])}
                    hasStems={hasDraftStems || renderedPlantPlans.length > 0}
                    hasCanopies={hasCanopies}
                    canvasHint={device && !objects.selection && (device === 'touch' ? showTouchContextMenuHint : showContextMenuHint) && (
                      <GraphicalObjectHint device={device} onClose={device === 'touch' ? closeTouchContextMenuHint : closeContextMenuHint} />
                    )}
                    boundaryWarning={fieldsOutsideBoundary.size > 0 && (
                      <Typography variant="caption" color="warning.dark" data-graphical-annotation-obstacle data-testid="location-boundary-overflow-hint"
                        sx={{ minWidth: 0, px: 1, py: 0.5, borderRadius: 2, overflowWrap: 'anywhere',
                          bgcolor: (theme) => alpha(theme.palette.common.white, 0.78), backdropFilter: 'blur(2px)' }}>
                        {t('fields:graphical.fieldsOutsideLocation')}
                      </Typography>
                    )}
                    cropLoading={locationPlans.loading} cropFailed={locationPlans.failed} onRetryCrops={locationPlans.refresh}
                    beds={parcels.flatMap(({ field, layout }) => layout.bedRects.map(bed => ({
                      id: bed.id, name: bed.name, parcel: field.name,
                    })))}
                    summaries={taskSummaries} loading={bedTasks.loading} failed={bedTasks.failed && (!showCrops || !locationPlans.failed)}
                    onRetry={bedTasks.refresh} onOpenBed={onOpenBed}
                  />
                  {objectInteractionEnabled && <GraphicalObjectOverlays interaction={objects} objects={objectModel}
                    viewport={viewport} stageWidth={stageWidth} stageHeight={stageHeight} root={activeCanvasRef}
                    openDetails={details} onOpenCrop={onOpenIndividualCrop} onFocusObject={focusArea}
                    canEditPlant={canEditPlant} onEditPlant={editPlant} bedTasks={previewTasks} plantTasks={bedTasks} cropPreview={cropPreview}
                    onStartIndividualPlan={individualSeason && individualPlants.canEdit && !individualPlants.editor.draft ? object => {
                      const parent = { kind: object.type, id: object.id };
                      if (fullscreenLocationId === locationId) {
                        void toggleFullscreen(locationId).then(() => startAutomaticIndividualPlan(parent));
                      } else {
                        startAutomaticIndividualPlan(parent);
                      }
                    } : undefined}
                    cropReference={showCrops ? cropReference : undefined}
                    hoverLayerData={(showTasks || showCrops) && activeSeasonId !== undefined ? {
                      byBed: openTasksByBed, summaries: taskSummaries, plantSummaries: plantTaskSummaries,
                      bounds: showTasks ? { today, upcomingEnd } : undefined,
                      crops: showCrops ? cropsByBed : undefined, cropLoading: showCrops && locationPlans.loading,
                      cropFailed: showCrops && locationPlans.failed,
                    } : undefined}
                    seasonId={activeSeasonId} canComplete={canCompleteTasks} showLocationLabel={showFallbackLocationLabel} />}
                </Box>
                {showIndividualPanel && (
                  <GraphicalIndividualPlantsPanel location={location} fields={parcels.map(({ field }) => field)} beds={beds}
                    season={individualSeason} controller={individualPlants}
                    placementContext={draftPlacement} preview={placementPreview} onKeyboardPlacement={keyboardPlacement}
                    onRefreshGeometry={() => setLayoutAttempt(attempt => attempt + 1)}
                    onClose={() => canvasToolsRefs.current[locationId]?.focus({ preventScroll: true })}
                    onFocusParent={focusIndividualParent} />
                )}
                </Box>
            </Box>
          );
        },
      )}

    </Box>
  );
}
