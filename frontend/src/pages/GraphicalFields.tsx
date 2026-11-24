import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
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
import { GraphicalFieldDetailsDialog } from "./GraphicalFieldDetailsDialog";
import { GraphicalFreeAreaInfo, GraphicalFreeRectangles } from "./GraphicalFreeAreas";
import { GraphicalGeometryWarnings } from "./GraphicalGeometryWarnings";
import { GraphicalSnapGuides } from "./GraphicalSnapGuides";
import { analyzeGraphicalGeometry, getGeometryOutlines, getGraphicalBedLayout, type GeometryPreview, type GraphicalParcel, type OutlineKind } from "./graphicalAreaGeometry";
import type { MetricCoverage } from "../components/hierarchy/utils/growingAreaGeometry";
import ModeToggle from "../components/ModeToggle";
import {
  clampInsideBoundary,
  clampInsideParent,
  fieldUsesWorldScale,
  getFieldRectSize,
  getLocationBoundaryRect,
  isRectOutsideBoundary,
  arrangeFieldRects,
  placeFieldRects,
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
  getBedLabelLayout,
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
  DEFAULT_STAGE_HEIGHT,
  FIELD_INNER_OFFSET_X,
  FIELD_INNER_OFFSET_Y,
  FIELD_SNAP_THRESHOLD,
  FIELD_WORLD_BASE_WIDTH,
  FIELD_WORLD_MAX_WIDTH,
  FIELD_WORLD_MIN_HEIGHT,
  FIELD_WORLD_MIN_WIDTH,
  FIELD_WORLD_PX_PER_METER,
  FIELD_WORLD_SCALE_FACTOR,
  LOCATION_FIELD_GAP,
  LOCATION_LAYOUT_PADDING,
  PAN_FAST_STEP,
  PAN_STEP,
  SNAP_THRESHOLD,
  WORKSPACE_MIN_HEIGHT,
  WORKSPACE_MIN_WIDTH,
  ZOOM_STEP,
  getFitViewportPadding,
  type BedViewModel,
  type GraphicalFieldsProps,
  type GraphicalCameraState,
  type GuideLine,
  type InteractionMode,
  type Point,
  type RectViewModel,
  type SelectedElement,
} from "./graphicalFieldsGeometry";
import { useAreaDrag, type AreaDragOptions, type DragSnapping } from "./graphicalAreaDrag";
import { useGraphicalStageSize } from "./useGraphicalStageSize";
import { formatLocalizedNumber, getActiveFormattingLocale } from "../utils/numberLocalization";
import { AppTooltip } from '../components/AppTooltip';
import LoadRetryButton from '../components/LoadRetryButton';

// A quick Graphic → List → Graphic switch must read after an in-flight drop.
const pendingFieldSaves = new Map<number, Promise<void>>();

export default function GraphicalFields({
  showTitle = true,
  interactionMode: controlledInteractionMode,
  onInteractionModeChange,
  showModeToggle = true,
  showFreeAreas = false,
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
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
  const stageRefs = useRef<Record<number, Konva.Stage | null>>({});
  const saveTimers = useRef<Record<string, number>>({});
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
        await pendingFieldSaves.get(activeLocationId);
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
    const timers = saveTimers.current;
    return () => {
      Object.values(timers).forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, []);

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
    const timerKey = `bed-${payload.bed}`;
    if (saveTimers.current[timerKey]) {
      window.clearTimeout(saveTimers.current[timerKey]);
    }

    saveTimers.current[timerKey] = window.setTimeout(async () => {
      try {
        await layoutAPI.saveByLocation(locationId, {
          bed_layouts: [payload],
          field_layouts: [],
        });
      } catch (saveError) {
        console.error("Failed to save bed layout", saveError);
      }
    }, 250);
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
    const save = layoutAPI.saveByLocation(locationId, {
      bed_layouts: [],
      field_layouts: [payload],
      ...(boundaryOrigin && { location_boundary: boundaryOrigin }),
    }).then(() => undefined).catch((saveError: unknown) => {
      setLayoutsByField((prev) => {
        const restored = { ...prev };
        if (previousLayout) restored[payload.field] = previousLayout;
        else delete restored[payload.field];
        return restored;
      });
      if (boundaryOrigin) {
        setBoundaryOriginByLocation((prev) => ({ ...prev, [locationId]: null }));
      }
      setFieldSaveErrorLocation(locationId);
      console.error("Failed to save field layout", saveError);
    }).finally(() => {
      pendingFieldSaves.delete(locationId);
    });
    pendingFieldSaves.set(locationId, save);
  };

  const fieldsByLocation = new Map<number, typeof fields>();
  locations.forEach((location) => {
    if (!location.id) return;
    fieldsByLocation.set(
      location.id,
      fields.filter(
        (field) => field.location === location.id && field.id !== undefined,
      ),
    );
  });

  const locationLayouts = locations.flatMap((location) => {
    if (!location.id) return [];
    const locationFields = fieldsByLocation.get(location.id) ?? [];
    const sizedFields = locationFields.map((field) => {
      const size = getFieldRectSize(field, FIELD_WORLD_PX_PER_METER, {
        baseWidth: FIELD_WORLD_BASE_WIDTH,
        minWidth: FIELD_WORLD_MIN_WIDTH,
        maxWidth: FIELD_WORLD_MAX_WIDTH,
        minHeight: FIELD_WORLD_MIN_HEIGHT,
        scaleFactor: FIELD_WORLD_SCALE_FACTOR,
      });
      return {
        field,
        width: size.width,
        height: size.height,
      };
    });
    const fitPadding = getFitViewportPadding(stageWidth, stageHeight);
    const arrangement = arrangeFieldRects(
      sizedFields,
      // Pack for the default quarter turn; later rotations preserve this arrangement.
      Math.max(1, stageHeight - fitPadding.top - fitPadding.bottom) /
        Math.max(1, stageWidth - fitPadding.left - fitPadding.right),
      LOCATION_FIELD_GAP,
    );
    const originX = Math.max(
      LOCATION_LAYOUT_PADDING,
      Math.round(WORKSPACE_MIN_WIDTH / 2 - arrangement.width / 2),
    );
    const originY = Math.max(
      LOCATION_LAYOUT_PADDING,
      Math.round(WORKSPACE_MIN_HEIGHT / 2 - arrangement.height / 2),
    );
    const defaultFieldRects = sizedFields.map((entry, index) => ({
      ...entry,
      defaultX: originX + arrangement.positions[index].x,
      defaultY: originY + arrangement.positions[index].y,
    }));

    const fieldsContentSize = {
      width: Math.max(
        WORKSPACE_MIN_WIDTH,
        ...defaultFieldRects.map(
          (rect) =>
            rect.width + rect.defaultX + LOCATION_LAYOUT_PADDING,
        ),
      ),
      height: Math.max(
        WORKSPACE_MIN_HEIGHT,
        DEFAULT_STAGE_HEIGHT,
        originY + arrangement.height + LOCATION_LAYOUT_PADDING,
      ),
    };
    const storedFieldRects = placeFieldRects(
      defaultFieldRects,
      layoutsByField,
      fieldsContentSize,
    );
    // A saved origin keeps the boundary fixed while plots move inside it.
    // Until one is saved the boundary starts at the plots' top-left corner
    // (#1190); the first plot move saves that corner as the origin.
    const savedBoundaryOrigin = boundaryOriginByLocation[location.id] ?? null;
    const storedFieldBounds = getContentBoundsFromRects(storedFieldRects);
    const storedBoundary = getLocationBoundaryRect(
      location,
      FIELD_WORLD_PX_PER_METER,
      savedBoundaryOrigin ??
        (storedFieldBounds
          ? { x: storedFieldBounds.minX, y: storedFieldBounds.minY }
          : { x: originX, y: originY }),
    );
    const contentWidth = Math.max(
      fieldsContentSize.width,
      storedBoundary ? storedBoundary.x + storedBoundary.width + LOCATION_LAYOUT_PADDING : 0,
    );
    const contentHeight = Math.max(
      fieldsContentSize.height,
      storedBoundary ? storedBoundary.y + storedBoundary.height + LOCATION_LAYOUT_PADDING : 0,
    );
    const rotation = rotationByLocation[location.id] ?? DEFAULT_GRAPHICAL_ROTATION;
    const storedContentSize = { width: contentWidth, height: contentHeight };
    const rotatedContent = rotateRect({ x: 0, y: 0, ...storedContentSize }, storedContentSize, rotation);
    const metricFieldIds = new Set(sizedFields
      .filter(rect => fieldUsesWorldScale(rect.field, rect, FIELD_WORLD_PX_PER_METER))
      .map(rect => rect.field.id));
    const fieldViewModels = storedFieldRects.map(rect => ({
      ...rotateRect(rect, storedContentSize, rotation),
      supportsMetricSpacing: metricFieldIds.has(rect.id),
    }));
    const boundary = storedBoundary
      ? rotateRect(storedBoundary, storedContentSize, rotation)
      : null;

    return [
      {
        location,
        defaultFieldRects,
        fieldViewModels,
        boundary,
        unsavedBoundaryOrigin:
          storedBoundary && !savedBoundaryOrigin
            ? { x: storedBoundary.x, y: storedBoundary.y }
            : null,
        contentWidth: rotatedContent.width,
        contentHeight: rotatedContent.height,
        rotation,
      },
    ];
  });

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
    updateViewport(locationId, (current) =>
      zoomAroundPoint(current, current.scale * factor, {
        x: stageWidth / 2,
        y: stageHeight / 2,
      }),
    );
  };

  const handleRotate = (locationId: number, direction: -1 | 1): void => {
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
    if (!stage || target !== stage) {
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
    beginPanSession(locationId, viewport, event);
  };

  const handleStageMouseMove = (
    locationId: number,
    event: KonvaEventObject<MouseEvent>,
  ): void => {
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
    if (touches.length === 1) {
      beginPanSession(locationId, viewport, event);
      return;
    }
    if (touches.length === 2) {
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
    locationName: string,
    locationId: number,
    rotation: GraphicalRotation,
    boundary: PlacementRect | null,
    unsavedBoundaryOrigin: LocationBoundaryOrigin | null,
    snapping: DragSnapping,
    coverage: MetricCoverage | undefined,
  ): KonvaNodeEvents & { draggable: boolean } => {
    if (!isLocationEditMode(locationId)) {
      const select = () => setSelectedElement({
        type: "field", id: fieldId, name: baseRect.field.name,
        area: Number(baseRect.field.area_sqm ?? 0), locationName, coverage,
      });
      return {
        draggable: false,
        onClick: select,
        onTap: select,
      };
    }

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
      blocked: () => pendingFieldSaves.has(locationId),
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
    locationName: string,
    fieldName: string,
    locationId: number,
    storedFieldInnerSize: RectSize,
    rotation: GraphicalRotation,
    snapping: DragSnapping,
  ): KonvaNodeEvents & { draggable: boolean } => {
    if (!isLocationEditMode(locationId)) {
      return {
        draggable: false,
        onClick: () => {
          setSelectedElement({
            type: "bed",
            id: bedVm.id,
            name: bedVm.name,
            area: bedVm.area,
            locationName,
            parentName: fieldName,
          });
        },
        onTap: () => {
          setSelectedElement({
            type: "bed",
            id: bedVm.id,
            name: bedVm.name,
            area: bedVm.area,
            locationName,
            parentName: fieldName,
          });
        },
      };
    }

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
        const nextLayout: BedLayoutEntry = { bed: bedVm.id, location: locationId, x: stored.x, y: stored.y, version: 1 };
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
      if (isTypingInEditableElement(event.target instanceof Element ? event.target : document.activeElement) || effectiveActivePanLocationId === null) {
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
          defaultFieldRects,
          fieldViewModels,
          boundary,
          unsavedBoundaryOrigin,
          contentWidth,
          contentHeight,
          rotation,
        }) => {
          if (!location.id) {
            return null;
          }
          const locationId = location.id;
          const fieldRectsById = new Map(fieldViewModels.map(rect => [rect.id, rect]));
          const parcels = defaultFieldRects.flatMap<GraphicalParcel>(stored => {
            const { field } = stored;
            const rect = fieldRectsById.get(field.id!);
            if (!rect) return [];
            return [{ field, rect, layout: getGraphicalBedLayout(
              field, stored, beds.filter(bed => bed.field === rect.id), layoutsByBed, rotation,
            ) }];
          });
          const pathSpacing = getLocationPathSpacing(location);
          const geometry = analyzeGraphicalGeometry(location, boundary, parcels, pathSpacing, rotation, geometryPreview, showFreeAreas);
          const locationCoverage = geometry.locationReport.coverage;
          const parcelCoverage = showFreeAreas ? [...geometry.parcelReports.values()].map(report => report.coverage) : [];
          const missingParcelDimensions = parcelCoverage.some(coverage => coverage.grossArea === null);
          const missingBedDimensions = parcelCoverage.some(coverage => coverage.grossArea !== null && coverage.freeRects === null);
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
          const viewport =
            viewportByLocation[locationId] ??
            fitBoundsToStage(
              contentBounds,
              { width: stageWidth, height: stageHeight },
              getFitViewportPadding(stageWidth, stageHeight),
            );
          const visibility = getVisibleElements(viewport.scale);
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
                {locationIsEditable ? (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>
                    <span>{t("fields:graphical.locationEditModeBanner")}</span>
                    {snapping.enabled ? <> {t("fields:graphical.spacing.bypass")}</> : null}
                  </Alert>
                ) : null}
                <Box
                  ref={(node: HTMLDivElement | null) => {
                    locationCanvasRefs.current[locationId] = node;
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
                  <Paper
                    elevation={3}
                    sx={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      zIndex: 2,
                      borderRadius: 3,
                      overflow: "hidden",
                      maxHeight: "calc(100% - 24px)",
                      overflowY: "auto",
                      bgcolor: "background.paper",
                    }}
                  >
                    <Stack spacing={0} sx={{ alignItems: "stretch", }} >
                      <GraphicalGeometryWarnings t={t} parcels={parcels} analysis={geometry}
                        outsideParcels={fieldsOutsideBoundary} focusArea={focusArea} />
                      {showFreeAreas ? <GraphicalFreeAreaInfo coverage={locationCoverage}
                        missingParcelDimensions={missingParcelDimensions} missingBedDimensions={missingBedDimensions} t={t} /> : null}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={0}>
                        {([-1, 1] as const).map(direction => (
                          <AppTooltip disableInteractive key={direction} title={t(direction === -1 ? "fields:graphical.rotateLeft" : "fields:graphical.rotateRight")} placement="left">
                            <IconButton
                              size="small"
                              onClick={() => handleRotate(locationId, direction)}
                              aria-label={t(direction === -1 ? "fields:graphical.rotateLeft" : "fields:graphical.rotateRight")}
                              sx={{ borderRadius: 0, p: 1.25 }}
                            >
                              {direction === -1 ? <RotateLeftIcon fontSize="small" /> : <RotateRightIcon fontSize="small" />}
                            </IconButton>
                          </AppTooltip>
                        ))}
                      </Stack>
                      <Box sx={{ display: { xs: "none", sm: "block" } }}>
                        <Box sx={{ display: "flex", justifyContent: "center" }}>
                          <AppTooltip disableInteractive title={t("fields:graphical.panUp")} placement="left">
                            <IconButton
                              size="small"
                              onClick={() => handlePanByOffset(locationId, 0, PAN_STEP)}
                              aria-label={t("fields:graphical.panUp")}
                              sx={{ borderRadius: 0, p: 1.25 }}
                            >
                              <KeyboardArrowUpIcon fontSize="small" />
                            </IconButton>
                          </AppTooltip>
                        </Box>
                        <Stack direction="row" spacing={0}>
                          <AppTooltip
                            disableInteractive
                            title={t("fields:graphical.panLeft")}
                            placement="left"
                          >
                            <IconButton
                              size="small"
                              onClick={() =>
                                handlePanByOffset(locationId, PAN_STEP, 0)
                              }
                              aria-label={t("fields:graphical.panLeft")}
                              sx={{
                                borderRadius: 0,
                                p: 1.25,
                                borderTop: "1px solid",
                                borderColor: "divider",
                                borderRight: "1px solid",
                              }}
                            >
                              <KeyboardArrowLeftIcon fontSize="small" />
                            </IconButton>
                          </AppTooltip>
                          <AppTooltip
                            disableInteractive
                            title={t("fields:graphical.panRight")}
                            placement="left"
                          >
                            <IconButton
                              size="small"
                              onClick={() =>
                                handlePanByOffset(locationId, -PAN_STEP, 0)
                              }
                              aria-label={t("fields:graphical.panRight")}
                              sx={{
                                borderRadius: 0,
                                p: 1.25,
                                borderTop: "1px solid",
                                borderColor: "divider",
                              }}
                            >
                              <KeyboardArrowRightIcon fontSize="small" />
                            </IconButton>
                          </AppTooltip>
                        </Stack>
                        <Box sx={{ display: "flex", justifyContent: "center" }}>
                          <AppTooltip
                            disableInteractive
                            title={t("fields:graphical.panDown")}
                            placement="left"
                          >
                            <IconButton
                              size="small"
                              onClick={() => handlePanByOffset(locationId, 0, -PAN_STEP)}
                              aria-label={t("fields:graphical.panDown")}
                              sx={{
                                borderRadius: 0,
                                p: 1.25,
                                borderTop: "1px solid",
                                borderColor: "divider",
                              }}
                            >
                              <KeyboardArrowDownIcon fontSize="small" />
                            </IconButton>
                          </AppTooltip>
                        </Box>
                      </Box>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={0}>
                        <AppTooltip
                          disableInteractive
                          title={t("fields:graphical.zoomIn")}
                          placement="left"
                        >
                          <IconButton
                            size="small"
                            onClick={() => handleZoom(locationId, ZOOM_STEP)}
                            aria-label={t("fields:graphical.zoomIn")}
                            sx={{ borderRadius: 0, p: 1.25 }}
                          >
                            <AddIcon fontSize="small" />
                          </IconButton>
                        </AppTooltip>
                        <AppTooltip
                          disableInteractive
                          title={t("fields:graphical.zoomOut")}
                          placement="left"
                        >
                          <IconButton
                            size="small"
                            onClick={() => handleZoom(locationId, 1 / ZOOM_STEP)}
                            aria-label={t("fields:graphical.zoomOut")}
                            sx={{
                              borderRadius: 0,
                              p: 1.25,
                              borderTop: "1px solid",
                              borderColor: "divider",
                            }}
                          >
                            <RemoveIcon fontSize="small" />
                          </IconButton>
                        </AppTooltip>
                      </Stack>
                      <AppTooltip
                        disableInteractive
                        title={t("fields:graphical.fitToView")}
                        placement="left"
                      >
                        <IconButton
                          size="small"
                          onClick={() => resetViewport(locationId)}
                          aria-label={t("fields:graphical.fitToView")}
                          sx={{
                            borderRadius: 0,
                            p: 1.25,
                            borderTop: "1px solid",
                            borderColor: "divider",
                          }}
                        >
                          <FitScreenIcon fontSize="small" />
                        </IconButton>
                      </AppTooltip>
                      <AppTooltip
                        disableInteractive
                        title={
                          fullscreenLocationId === locationId
                            ? t("fields:graphical.exitFullscreen")
                            : t("fields:graphical.enterFullscreen")
                        }
                        placement="left"
                      >
                        <IconButton
                          size="small"
                          onClick={() => {
                            void toggleFullscreen(locationId);
                          }}
                          aria-label={
                            fullscreenLocationId === locationId
                              ? t("fields:graphical.exitFullscreen")
                              : t("fields:graphical.enterFullscreen")
                          }
                          sx={{
                            borderRadius: 0,
                            p: 1.25,
                            borderTop: "1px solid",
                            borderColor: "divider",
                          }}
                        >
                          {fullscreenLocationId === locationId ? (
                            <FullscreenExitIcon fontSize="small" />
                          ) : (
                            <FullscreenIcon fontSize="small" />
                          )}
                        </IconButton>
                      </AppTooltip>
                    </Stack>
                  </Paper>
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
                    onMouseLeave={() => handleStageMouseUp(locationId)}
                    onWheel={(event) => handleStageWheel(locationId, event)}
                    onDblTap={() => handleStageDoubleTap(locationId)}
                    onDblClick={() => handleStageDoubleTap(locationId)}
                    onTouchStart={(event) =>
                      handleStageTouchStart(locationId, viewport, event)
                    }
                    onTouchMove={(event) =>
                      handleStageTouchMove(locationId, event)
                    }
                    onTouchEnd={() => handleStageTouchEnd(locationId)}
                    ref={(node) => {
                      stageRefs.current[locationId] = node;
                    }}
                  >
                    <Layer>
                      {boundary ? (
                        <Group listening={false}>
                          {showFreeAreas ? <GraphicalFreeRectangles coverage={locationCoverage} origin={boundary}
                            scale={{ x: FIELD_WORLD_PX_PER_METER, y: FIELD_WORLD_PX_PER_METER }} kind="site" /> : null}
                          <Rect
                            {...boundary}
                            stroke={theme.palette.text.secondary}
                            strokeWidth={2}
                            strokeScaleEnabled={false}
                            dash={[8, 6]}
                            cornerRadius={4}
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
                        const bedSpacing = pixelsPerMeter
                          ? { centimeters: pathSpacing.bed_path_spacing_cm, pixelsPerMeter }
                          : undefined;
                        const fieldWarning = parcelWarnings.get(fieldId)
                          ?? (parcelReport?.issues.some(issue => issue.kind === "noPathSpace") ? "shortGap" : undefined);
                        const { onClick, onTap, ...fieldDragProps } = getFieldInteractionProps(
                          fieldId, baseRect, currentFieldRect,
                          { width: contentWidth, height: contentHeight },
                          fieldViewModels, location.name, locationId, rotation, boundary, unsavedBoundaryOrigin,
                          { ...snapping, thresholdPx: FIELD_SNAP_THRESHOLD, spacing: {
                            centimeters: pathSpacing.parcel_path_spacing_cm,
                            pixelsPerMeter: { x: FIELD_WORLD_PX_PER_METER, y: FIELD_WORLD_PX_PER_METER },
                          } },
                          parcelReport?.coverage,
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
                            {/* The margin and usable area only paint; the
                                outline and beds provide the hit targets. */}
                            <Rect
                              width={baseRect.width}
                              height={baseRect.height}
                              fill={theme.palette.grey[200]}
                              cornerRadius={4}
                              listening={false}
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
                            {showFreeAreas && pixelsPerMeter ? <GraphicalFreeRectangles coverage={parcelReport?.coverage}
                              origin={fieldUsableArea} scale={pixelsPerMeter} kind="parcel" /> : null}
                            <Rect
                              width={baseRect.width}
                              height={baseRect.height}
                              {...getOutlineProps(fieldWarning, theme.palette.primary.main, 2)}
                              data-geometry-issue={fieldWarning}
                              cornerRadius={4}
                              data-testid={`field-rect-${fieldId}`}
                              data-outside-location={fieldsOutsideBoundary.has(fieldId) || undefined}
                              onClick={onClick}
                              onTap={onTap}
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
                              ? bedRects.map((bedVm) => (
                                  <Group key={bedVm.id}>
                                    <Rect
                                      x={FIELD_INNER_OFFSET_X + bedVm.x}
                                      y={FIELD_INNER_OFFSET_Y + bedVm.y}
                                      width={bedVm.width}
                                      height={bedVm.height}
                                      fill={theme.palette.info.light}
                                      {...getOutlineProps(bedWarnings.get(bedVm.id), theme.palette.info.main, 1)}
                                      data-geometry-issue={bedWarnings.get(bedVm.id)}
                                      name="graphical-editable"
                                      data-testid={`bed-rect-${bedVm.id}`}
                                      {...getBedInteractionProps(
                                        bedVm,
                                        currentFieldRect,
                                        fieldUsableArea,
                                        bedRects,
                                        location.name,
                                        baseRect.field.name,
                                        locationId,
                                        storedUsableArea,
                                        rotation,
                                        { ...snapping, thresholdPx: SNAP_THRESHOLD, spacing: bedSpacing },
                                      )}
                                    />
                                    {(() => {
                                      const label = getBedLabelLayout(bedVm, viewport.scale);
                                      if (!visibility.showBedLabels || !label) return null;
                                      const labelText =
                                        visibility.showDetailedBedLabels &&
                                        !label.compact
                                          ? `${bedVm.name} (${bedVm.area || "-"} m²)`
                                          : bedVm.name;
                                      return (
                                        <Text
                                          x={FIELD_INNER_OFFSET_X + label.x + bedVm.x}
                                          y={FIELD_INNER_OFFSET_Y + label.y + bedVm.y}
                                          text={labelText}
                                          fontSize={label.fontSize}
                                          width={label.width}
                                          height={label.height}
                                          rotation={label.rotation}
                                          lineHeight={1}
                                          wrap="none"
                                          ellipsis
                                          data-testid={`bed-label-${bedVm.id}`}
                                          listening={false}
                                          scaleX={1 / viewport.scale}
                                          scaleY={1 / viewport.scale}
                                        />
                                      );
                                      })()}
                                  </Group>
                                ))
                              : null}
                          </Group>
                        );
                      })}

                      <GraphicalSnapGuides guides={activeGuides} scale={viewport.scale} />
                    </Layer>
                  </Stage>
                </Box>
            </Box>
          );
        },
      )}

      <GraphicalFieldDetailsDialog
        element={selectedElement}
        onClose={() => setSelectedElement(null)}
        t={t}
      />
    </Box>
  );
}
