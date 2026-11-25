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
import { Group, Layer, Rect, Stage, Text, type KonvaNodeEvents } from "react-konva";
import type Konva from "konva";
import { alpha } from "@mui/material/styles";
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
import { GraphicalObjectHint, GraphicalObjectOverlays, type GraphicalObject } from "./GraphicalObjectOverlays";
import { graphicalObjectKey, useGraphicalObjectInteraction } from "./useGraphicalObjectInteraction";
import { useContextMenuHint } from "../components/data-grid/useContextMenuHint";
import { GraphicalFreeRectangles } from "./GraphicalFreeAreas";
import { GraphicalDisplayLegend } from "./GraphicalDisplayLegend";
import { GraphicalBedLabels } from "./GraphicalBedLabels";
import { getGanttPhaseColors } from "../utils/colorContrast";
import { includesCrops, includesTasks, indexBedCultivations, projectBedCultivation } from "./graphicalCultivation";
import { GraphicalCanvasTools } from "./GraphicalCanvasTools";
import { bedTaskColors } from "./graphicalBedTaskStyle";
import { bedTaskDateBounds, orderBedTasks, summarizeBedTasks } from "../components/tasks/bedTaskUrgency";
import { useAreaPlantingPlans, useBedTasks } from "../components/tasks/useBedTasks";
import { isOpenTask } from "../components/tasks/taskBoard";
import { useIndividualPlants } from "./useIndividualPlants";
import { GraphicalIndividualPlantsLayer, type CanvasStem } from "./GraphicalIndividualPlantsLayer";
import { GraphicalIndividualPlantsPanel } from "./GraphicalIndividualPlantsPanel";
import { GraphicalGeometryWarnings } from "./GraphicalGeometryWarnings";
import { GraphicalSnapGuides } from "./GraphicalSnapGuides";
import { analyzeGraphicalGeometry, getGeometryOutlines, getGraphicalBedLayout, getSchematicLocationLayout, type GeometryPreview, type GraphicalParcel, type OutlineKind } from "./graphicalAreaGeometry";
import ModeToggle from "../components/ModeToggle";
import {
  clampInsideBoundary,
  clampInsideParent,
  isRectOutsideBoundary,
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
  shouldShowFieldLabel,
  getFieldLabelScreenWidth,
  FIELD_LABEL_SCREEN_PADDING,
  startPanSession,
  toContentBounds,
  type ContentBounds,
  type PanSession,
  type ViewportState,
  zoomAroundPoint,
} from "./graphicalViewport";
import {
  FIELD_INNER_OFFSET_X,
  FIELD_INNER_OFFSET_Y,
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
  displayLegendAnchor,
  closeDisplayLegend,
  individualSeason,
  canEditIndividualPlants = false,
  requestedIndividualPlan,
  onOpenBed,
  onOpenDetails,
  canCompleteTasks = false,
  hierarchyData,
  selectedLocationId,
  cameraState: controlledCameraState,
  onCameraStateChange,
}: GraphicalFieldsProps) {
  const { t } = useTranslation(["fields", "common"]);
  const theme = useTheme();
  const getOutlineProps = (kind: OutlineKind | undefined, color: string, width: number) => {
    switch (kind) {
      case "outside": return { stroke: theme.palette.warning.dark, strokeWidth: 2.5, dash: [9, 4] };
      case "overlap": return { stroke: theme.palette.error.dark, strokeWidth: 2.5, dash: [4, 2] };
      case "shortGap": return { stroke: theme.palette.secondary.dark, strokeWidth: 2.5, dash: [2, 4] };
      default: return { stroke: color, strokeWidth: width };
    }
  };
  const internalHierarchyData = useHierarchyData(hierarchyData === undefined);
  const { loading, error, locations, fields, beds } = hierarchyData ?? internalHierarchyData;
  const activeLocationId = locations.find(location => location.id === selectedLocationId)?.id
    ?? locations.find(location => typeof location.id === 'number' && location.id > 0)?.id ?? null;
  const individualPlants = useIndividualPlants(
    activeLocationId, individualSeason, canEditIndividualPlants, requestedIndividualPlan,
  );
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
  const [fieldSaveErrorLocation, setFieldSaveErrorLocation] = useState<number | null>(null);
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
  const objects = useGraphicalObjectInteraction(objectInteractionEnabled, activeLocationId);
  const selectedBedId = objects.selection?.startsWith('bed:') ? Number(objects.selection.slice(4)) : null;
  const showCrops = includesCrops(displayMode);
  const showTasks = includesTasks(displayMode);
  const loadLocationPlans = showCrops || showTasks;
  const locationPlans = useAreaPlantingPlans('location', loadLocationPlans ? activeLocationId : null, activeSeasonId);
  const selectedPlans = useAreaPlantingPlans('bed', loadLocationPlans ? null : selectedBedId, activeSeasonId);
  const bedTasks = useBedTasks('location', showTasks || (showCrops && selectedBedId !== null) ? activeLocationId : null,
    activeSeasonId, locationPlans);
  const selectedBedTasks = useBedTasks('bed', loadLocationPlans ? null : selectedBedId, activeSeasonId, selectedPlans);
  const previewTasks = loadLocationPlans ? bedTasks : selectedBedTasks;
  const planRequest = loadLocationPlans ? locationPlans : selectedPlans;
  const plansByBed = useMemo(() => indexBedCultivations(planRequest.plans), [planRequest.plans]);
  const cropsByBed = useMemo(() => {
    if (!cropReference || !individualSeason) return new Map();
    return new Map(Array.from(plansByBed, ([id, plans]) => [id, projectBedCultivation(plans, cropReference, individualSeason)]));
  }, [cropReference, individualSeason, plansByBed]);
  const openTasksByBed = useMemo(() => new Map(Array.from(bedTasks.tasksByBed,
    ([id, tasks]) => [id, orderBedTasks(tasks.filter(isOpenTask))])), [bedTasks.tasksByBed]);
  const taskSummaries = useMemo(() => {
    const bounds = bedTaskDateBounds(new Date());
    return new Map(Array.from(bedTasks.tasksByBed, ([id, tasks]) => [id, summarizeBedTasks(tasks, bounds)]));
  }, [bedTasks.tasksByBed]);
  const cropPreview = cropReference && selectedBedId !== null ? {
    reference: cropReference,
    entries: cropsByBed.get(selectedBedId) ?? [],
    loading: planRequest.loading,
    failed: planRequest.failed,
    refresh: planRequest.refresh,
  } : undefined;
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const finePointer = useMediaQuery('(pointer: fine)');
  const device = objects.device ?? (coarsePointer ? 'touch' : finePointer ? 'desktop' : null);
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
    void saveTrackedBedLayout(locationId, payload.bed, () => layoutAPI.saveByLocation(locationId, {
      bed_layouts: [payload],
      field_layouts: [],
    })).catch((saveError: unknown) => {
      console.error("Failed to save bed layout", saveError);
    });
  };

  const saveFieldLayout = (
    locationId: number,
    payload: FieldLayoutEntry,
    boundaryOrigin: LocationBoundaryOrigin | null,
  ): void => {
    const previousLayout = layoutsByField[payload.field];
    setFieldSaveErrorLocation(null);
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
      setFieldSaveErrorLocation(locationId);
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
        field, stored, beds.filter(bed => bed.field === rect.id), layoutsByBed, rotation,
      ) }];
    });
    const spacing = getLocationPathSpacing(location);
    const savedGeometry = analyzeGraphicalGeometry(location, boundary, parcels, spacing, rotation, null, true);
    return { parcels, fieldRectsById, spacing, savedGeometry };
  }, [activeLayout, beds, layoutsByBed]);
  const geometry = useMemo(() => {
    if (!activeLayout || !activeScene) return null;
    if (!geometryPreview) return activeScene.savedGeometry;
    return analyzeGraphicalGeometry(
      activeLayout.location, activeLayout.boundary, activeScene.parcels, activeScene.spacing,
      activeLayout.rotation, geometryPreview, true, activeScene.savedGeometry,
    );
  }, [activeLayout, activeScene, geometryPreview]);

  const objectModel = useMemo(() => {
    if (!activeLayout || !activeScene || !geometry || activeLocationId === null) return new Map<string, GraphicalObject>();
    const { location, boundary } = activeLayout;
    const { parcels } = activeScene;
    const locationId = activeLocationId;
    const locationKey = graphicalObjectKey('location', locationId);
    const model = new Map<string, GraphicalObject>([[locationKey, {
      key: locationKey, type: 'location', id: locationId, name: location.name,
      metrics: location, rect: boundary, coverage: geometry.locationReport.coverage,
    }]]);
    for (const { field, rect, layout } of parcels) {
      const fieldKey = graphicalObjectKey('field', rect.id);
      model.set(fieldKey, { key: fieldKey, id: rect.id, type: 'field', name: field.name,
        parent: location.name, metrics: field, rect, coverage: geometry.parcelReports.get(rect.id)?.coverage });
      for (const bed of layout.bedRects) {
        const key = graphicalObjectKey('bed', bed.id);
        const entity = bedsById.get(bed.id);
        if (entity) model.set(key, { key, id: bed.id, type: 'bed', name: bed.name, parent: field.name,
          metrics: entity, rect: { ...bed, x: rect.x + FIELD_INNER_OFFSET_X + bed.x, y: rect.y + FIELD_INNER_OFFSET_Y + bed.y } });
      }
    }
    return model;
  }, [activeLayout, activeScene, activeLocationId, bedsById, geometry]);

  const getContentBoundsForLocation = (locationId: number): ContentBounds => {
    const layout = locationLayouts.find((item) => item.location.id === locationId);
    if (!layout) {
      return toContentBounds({ width: stageWidth, height: stageHeight });
    }

    const fieldBounds = getContentBoundsFromRects(
      layout.boundary ? [layout.boundary, ...layout.fieldViewModels] : layout.fieldViewModels,
    );
    return (
      fieldBounds ??
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
    handleZoom(locationId, ZOOM_STEP);
  };

  const canStartPanSession = (
    event: KonvaEventObject<MouseEvent | TouchEvent>,
  ): boolean => {
    const target = event.target;
    const stage = target?.getStage?.();
    if (!stage || (target !== stage && !objects.isObjectTarget(event))) {
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
    baseRect: Pick<(typeof locationLayouts)[number]["defaultFieldRects"][number], "field" | "width" | "height">,
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

    const fieldSize = { width: baseRect.width, height: baseRect.height };
    // Plots stay on the workspace and, when the location has a boundary,
    // inside it; plots without a boundary keep the workspace-only clamp.
    const constrain = (position: Point): Point => {
      const onWorkspace = clampInsideParent(position, fieldSize, contentBounds);
      return boundary ? clampInsideBoundary(onWorkspace, fieldSize, boundary) : onWorkspace;
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
        const stored = rotateRect({ ...baseRect, ...position }, contentBounds, inverseRotation);
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
    fieldInnerSize: { width: number; height: number },
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
      offset: { x: FIELD_INNER_OFFSET_X, y: FIELD_INNER_OFFSET_Y },
      onPreview: position => setGeometryPreview(position && { type: "bed", id: bedVm.id, locationId, position }),
      onGuides: guides => setActiveGuides(guides.map(guide => {
        const x = currentFieldRect.x + FIELD_INNER_OFFSET_X;
        const y = currentFieldRect.y + FIELD_INNER_OFFSET_Y;
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
        setLayoutsByBed(prev => ({ ...prev, [bedVm.id]: nextLayout }));
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
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [areaDrag, effectiveActivePanLocationId, handlePanByOffset, layoutFailed, layoutReady]);

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
          const contentBounds = getContentBoundsForLocation(locationId);
          const locationIsEditable = isLocationEditMode(locationId);
          const showIndividualPanel = individualSeason && individualPlants.editor.open && !locationIsEditable
            && fullscreenLocationId !== locationId;
          const stemDraft = showIndividualPanel ? individualPlants.editor.draft : null;
          const viewport =
            viewportByLocation[locationId] ??
            fitBoundsToStage(
              contentBounds,
              { width: stageWidth, height: stageHeight },
              getFitViewportPadding(stageWidth, stageHeight),
            );
          const visibility = getVisibleElements(viewport.scale);
          const locationKey = graphicalObjectKey('location', locationId);
          const details = (object: GraphicalObject) => onOpenDetails?.(object.type, object.id);
          const overlayKey = objects.menu?.key ?? objects.selection;
          const highlight = overlayKey ? objectModel.get(overlayKey)?.rect : null;
          const showFallbackLocationLabel = !boundary || viewport.x + (boundary.x + boundary.width) * viewport.scale < 0
            || viewport.x + boundary.x * viewport.scale > stageWidth - 100
            || viewport.y + boundary.y * viewport.scale < 60 || viewport.y + boundary.y * viewport.scale > stageHeight;
          const snapping = { enabled: pathSpacing.snap_to_path_spacing, zoom: viewport.scale };
          const focusArea = (rect: PlacementRect): void => {
            setViewportByLocation(previous => ({ ...previous, [locationId]: {
              scale: viewport.scale,
              x: stageWidth / 2 - (rect.x + rect.width / 2) * viewport.scale,
              y: stageHeight / 2 - (rect.y + rect.height / 2) * viewport.scale,
            } }));
          };

          return (
            <Box key={locationId} role="region" aria-label={t("fields:graphical.locationTitle", { name: location.name })}>
                {fieldSaveErrorLocation === locationId ? (
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
                    touchAction: "none",
                    position: "relative",
                    bgcolor: "background.paper",
                    height:
                      fullscreenLocationId === locationId
                        ? "100vh"
                        : undefined,
                  }}
                >
                  {!objects.selection && device === 'touch' && showTouchContextMenuHint && (
                    <GraphicalObjectHint device="touch" onClose={closeTouchContextMenuHint}
                      hasWarning={fieldsOutsideBoundary.size > 0} />
                  )}
                  {!objects.selection && device === 'desktop' && showContextMenuHint && (
                    <GraphicalObjectHint device="desktop" onClose={closeContextMenuHint}
                      hasWarning={fieldsOutsideBoundary.size > 0} />
                  )}
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
                    } : undefined}
                  />
                  {fullscreenLocationId === locationId && fullscreenDisplayControls && (
                    <Box sx={{ position: 'absolute', zIndex: 2, top: 12, left: 105,
                      right: 110, width: 'fit-content', bgcolor: 'background.paper' }}>
                      {fullscreenDisplayControls}
                    </Box>
                  )}
                  {displayLegendAnchor && closeDisplayLegend && (
                    <GraphicalDisplayLegend anchor={displayLegendAnchor} onClose={closeDisplayLegend}
                      showCrops={showCrops} showTasks={showTasks}
                      cropLoading={locationPlans.loading} cropFailed={locationPlans.failed} onRetryCrops={locationPlans.refresh}
                      beds={parcels.flatMap(({ field, layout }) => layout.bedRects.map(bed => ({
                        id: bed.id, name: bed.name, parcel: field.name,
                      })))}
                      summaries={taskSummaries} loading={bedTasks.loading} failed={bedTasks.failed && (!showCrops || !locationPlans.failed)}
                      onRetry={bedTasks.refresh} onOpenBed={onOpenBed} />
                  )}
                  {!locationIsEditable && ((showCrops && (locationPlans.loading || locationPlans.failed))
                    || (showTasks && (bedTasks.loading || bedTasks.failed))) && (
                    <Stack sx={{ position: 'absolute', zIndex: 2, left: 12, right: 110, top: 54,
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
                  {fieldsOutsideBoundary.size > 0 ? (
                    <Typography
                      variant="caption"
                      color="warning.dark"
                      data-testid="location-boundary-overflow-hint"
                      sx={{
                        position: "absolute",
                        left: 12,
                        bottom: 12,
                        right: 12,
                        zIndex: 2,
                        px: 1,
                        py: 0.5,
                        borderRadius: 2,
                        width: "fit-content",
                        maxWidth: "calc(100% - 24px)",
                        bgcolor: (theme) => alpha(theme.palette.common.white, 0.78),
                        backdropFilter: "blur(2px)",
                      }}
                    >
                      {t("fields:graphical.fieldsOutsideLocation")}
                    </Typography>
                  ) : null}
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
                    onDblTap={() => handleStageDoubleTap(locationId)}
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
                            cornerRadius={4}
                            listening={false}
                            data-testid={`location-boundary-${locationId}`}
                          />
                          <Text
                            x={boundary.x}
                            y={boundary.y - (FIELD_LABEL_SCREEN_PADDING + 14) / viewport.scale}
                            text={t("fields:graphical.locationBoundaryLabel", {
                              name: location.name,
                              width: formatLocalizedNumber(location.width_m ?? 0, getActiveFormattingLocale(), { maximumFractionDigits: 2 }),
                              length: formatLocalizedNumber(location.length_m ?? 0, getActiveFormattingLocale(), { maximumFractionDigits: 2 }),
                            })}
                            fill={theme.palette.text.secondary}
                            wrap="none"
                            scaleX={1 / viewport.scale}
                            scaleY={1 / viewport.scale}
                            visible={!showFallbackLocationLabel || !objectInteractionEnabled}
                            listening={objectInteractionEnabled && !showFallbackLocationLabel}
                            data-graphical-object-key={locationKey}
                            data-testid={`location-boundary-label-${locationId}`}
                          />
                        </Group>
                      ) : null}
                      {parcels.map(({ field, rect: currentFieldRect, layout }) => {
                        const fieldId = currentFieldRect.id;
                        const { fieldSize, usableArea: fieldUsableArea, storedUsableArea, pixelsPerMeter, bedRects } = layout;
                        const baseRect = { field, width: fieldSize.width, height: fieldSize.height };
                        const parcelReport = geometry.parcelReports.get(fieldId);
                        const bedWarnings = getGeometryOutlines(parcelReport?.issues ?? []);
                        const canvasStems: CanvasStem[] = individualPlants.plans.flatMap(plan => (
                          plan.parcel === fieldId && plan.id !== stemDraft?.planId
                            ? (plan.individual_positions ?? []).map(stem => ({
                              ...stem, key: stem.id, planId: plan.id ?? null,
                              canopy: Number(plan.estimated_canopy_diameter_m ?? 0),
                              selected: Boolean(showIndividualPanel) && stem.id === individualPlants.editor.selectedKey,
                            })) : []
                        ));
                        if (stemDraft?.parcel === fieldId) {
                          canvasStems.push(...stemDraft.stems.map(stem => ({
                            ...stem, planId: stemDraft.planId ?? null,
                            canopy: Number(stemDraft.canopy ?? 0),
                            selected: stem.key === individualPlants.editor.selectedKey,
                          })));
                        }
                        const bedSpacing = pixelsPerMeter
                          ? { centimeters: pathSpacing.bed_path_spacing_cm, pixelsPerMeter }
                          : undefined;
                        const fieldWarning = parcelWarnings.get(fieldId)
                          ?? (parcelReport?.issues.some(issue => issue.kind === "noPathSpace") ? "shortGap" : undefined);
                        const fieldDragProps = getFieldInteractionProps(
                          fieldId, baseRect, currentFieldRect,
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
                            {/* The full parcel is a view-mode hit target. In edit mode
                                only the original outline and bed handles start a drag. */}
                            <Rect
                              width={baseRect.width}
                              height={baseRect.height}
                              fill={theme.palette.grey[200]}
                              cornerRadius={4}
                              listening={objectInteractionEnabled}
                              data-graphical-object-key={graphicalObjectKey('field', fieldId)}
                              data-testid={`field-margin-${fieldId}`}
                            />
                            <Rect
                              x={fieldUsableArea.x}
                              y={fieldUsableArea.y}
                              width={fieldUsableArea.width}
                              height={fieldUsableArea.height}
                              fill={theme.palette.common.white}
                              listening={false}
                              data-testid={`field-usable-area-${fieldId}`}
                            />
                            {pixelsPerMeter ? <GraphicalFreeRectangles coverage={parcelReport?.coverage}
                              origin={fieldUsableArea} scale={pixelsPerMeter} kind="parcel" /> : null}
                            <Rect
                              width={baseRect.width}
                              height={baseRect.height}
                              {...getOutlineProps(fieldWarning, theme.palette.primary.main, 2)}
                              data-geometry-issue={fieldWarning}
                              cornerRadius={4}
                              data-testid={`field-rect-${fieldId}`}
                              data-outside-location={fieldsOutsideBoundary.has(fieldId) || undefined}
                              data-graphical-object-key={graphicalObjectKey('field', fieldId)}
                            />
                            {shouldShowFieldLabel(
                              {
                                width: baseRect.width,
                                height: baseRect.height,
                              },
                              viewport.scale,
                            ) ? (
                              <Text
                                x={FIELD_LABEL_SCREEN_PADDING / viewport.scale}
                                y={FIELD_LABEL_SCREEN_PADDING / viewport.scale}
                                text={baseRect.field.name}
                                width={getFieldLabelScreenWidth(baseRect, viewport.scale)}
                                wrap="none"
                                ellipsis
                                fontStyle="bold"
                                listening={false}
                                scaleX={1 / viewport.scale}
                                scaleY={1 / viewport.scale}
                              />
                            ) : null}
                            {visibility.showBeds
                              ? bedRects.map((bedVm) => {
                                const shownMode = locationIsEditable ? 'areas' : displayMode;
                                const entries = showCrops && !locationIsEditable ? cropsByBed.get(bedVm.id) ?? [] : [];
                                const tasks = showTasks && !locationIsEditable ? openTasksByBed.get(bedVm.id) ?? [] : [];
                                const urgency = tasks.length ? taskSummaries.get(bedVm.id)?.urgency : undefined;
                                const taskColors = urgency ? bedTaskColors(theme, urgency) : null;
                                const phase = entries.length === 1 ? entries[0].phase : null;
                                const color = entries[0]?.plan.color;
                                const phaseColors = phase
                                  ? getGanttPhaseColors(color && /^#[\da-f]{6}$/i.test(color) ? color : theme.palette.success.main) : null;
                                const cropFill = phaseColors ? alpha(phaseColors[phase === 'harvest' ? 'harvest' : 'growth'], 0.45)
                                  : entries.length ? alpha(theme.palette.grey[700], 0.22) : undefined;
                                const fill = shownMode === 'tasks' ? taskColors?.fill : cropFill;
                                return (
                                  <Group key={bedVm.id}>
                                    <Rect
                                      x={FIELD_INNER_OFFSET_X + bedVm.x}
                                      y={FIELD_INNER_OFFSET_Y + bedVm.y}
                                      width={bedVm.width}
                                      height={bedVm.height}
                                      fill={fill ?? theme.palette.info.light}
                                      {...getOutlineProps(bedWarnings.get(bedVm.id), theme.palette.info.main, 1)}
                                      data-geometry-issue={bedWarnings.get(bedVm.id)}
                                      data-task-urgency={urgency}
                                      data-crop-phase={phase ?? (entries.length > 1 ? 'mixed' : undefined)}
                                      name="graphical-editable"
                                      data-testid={`bed-rect-${bedVm.id}`}
                                      data-graphical-object-key={graphicalObjectKey('bed', bedVm.id)}
                                      {...getBedInteractionProps(
                                        bedVm,
                                        currentFieldRect,
                                        fieldUsableArea,
                                        bedRects,
                                        locationId,
                                        storedUsableArea,
                                        rotation,
                                        { ...snapping, thresholdPx: SNAP_THRESHOLD, spacing: bedSpacing },
                                      )}
                                    />
                                    {visibility.showBedLabels && <GraphicalBedLabels bed={bedVm} scale={viewport.scale}
                                      mode={shownMode} detailedArea={visibility.showDetailedBedLabels}
                                      crops={entries} tasks={tasks} urgency={urgency} />}
                                  </Group>
                                );
                              })
                              : null}
                            {pixelsPerMeter && (
                              <GraphicalIndividualPlantsLayer field={field} surface={fieldUsableArea}
                                pixelsPerMeter={pixelsPerMeter} rotation={rotation} zoom={viewport.scale}
                                stems={canvasStems}
                                placing={stemDraft?.parcel === fieldId && Boolean(individualPlants.editor.placing)}
                                editablePlanId={stemDraft?.parcel === fieldId && !individualPlants.editor.saving
                                  ? stemDraft.planId ?? null : undefined}
                                onAdd={position => {
                                  const { placing, selectedKey } = individualPlants.editor;
                                  if (placing === "move" && selectedKey) individualPlants.changeStem(selectedKey, position);
                                  if (placing === "add") individualPlants.addStem(position);
                                  const panel = containerRef.current?.querySelector<HTMLElement>("[data-individual-plants-panel]");
                                  panel?.focus({ preventScroll: true });
                                  panel?.scrollIntoView({ block: "nearest" });
                                }}
                                onMove={individualPlants.changeStem}
                                onSelect={!locationIsEditable && fullscreenLocationId !== locationId
                                  ? stem => individualPlants.select(stem.planId, fieldId, stem.key)
                                  : undefined} />
                            )}
                          </Group>
                        );
                      })}

                      {highlight && <Rect {...highlight} listening={false} cornerRadius={3} strokeWidth={3}
                        strokeScaleEnabled={false} stroke={theme.palette.success.dark}
                        data-testid="graphical-object-highlight" />}
                      <GraphicalSnapGuides guides={activeGuides} scale={viewport.scale} />
                    </Layer>
                  </Stage>
                  {objectInteractionEnabled && <GraphicalObjectOverlays interaction={objects} objects={objectModel}
                    viewport={viewport} stageWidth={stageWidth} stageHeight={stageHeight} root={activeCanvasRef}
                    openDetails={details} onFocusObject={focusArea} bedTasks={previewTasks} cropPreview={cropPreview}
                    seasonId={activeSeasonId} canComplete={canCompleteTasks} showLocationLabel={showFallbackLocationLabel} />}
                </Box>
                {showIndividualPanel && (
                  <GraphicalIndividualPlantsPanel fields={parcels.map(({ field }) => field)}
                    season={individualSeason} controller={individualPlants}
                    onClose={() => canvasToolsRefs.current[locationId]?.focus({ preventScroll: true })}
                    onFocusParcel={fieldId => {
                      const field = fieldRectsById.get(fieldId);
                      const bounds = field ? getContentBoundsFromRects([field]) : null;
                      if (!bounds) return;
                      const next = fitBoundsToStage(bounds, { width: stageWidth, height: stageHeight },
                        getFitViewportPadding(stageWidth, stageHeight));
                      setViewportByLocation(previous => ({ ...previous, [locationId]: next }));
                      locationCanvasRefs.current[locationId]?.scrollIntoView({ block: "nearest" });
                    }} />
                )}
                </Box>
            </Box>
          );
        },
      )}

    </Box>
  );
}
