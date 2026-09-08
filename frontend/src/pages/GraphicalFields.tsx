import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import { Group, Layer, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useHierarchyData } from "../components/hierarchy/hooks/useHierarchyData";
import { useExpandedState } from "../components/hierarchy/hooks/useExpandedState";
import {
  layoutAPI,
  type BedLayoutEntry,
  type FieldLayoutEntry,
} from "../api/api";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useTranslation } from "../i18n";
import { GraphicalFieldDetailsDialog } from "./GraphicalFieldDetailsDialog";
import ModeToggle from "../components/ModeToggle";
import {
  clampInsideParent,
  DEFAULT_PLACEMENT_SPACING,
  getBedRectSizeWithinField,
  getFieldRectSize,
  initialAutoLayout,
  type Rect as PlacementRect,
  type RectSize,
} from "./graphicalLayoutUtils";
import {
  clampViewportToStage,
  fitBoundsToStage,
  getContentBoundsFromRects,
  getVisibleElements,
  panViewport,
  shouldShowBedLabel,
  shouldShowFieldLabel,
  startPanSession,
  toContentBounds,
  type ContentBounds,
  type PanSession,
  type ViewportState,
  zoomAroundPoint,
} from "./graphicalViewport";
import {
  DEFAULT_STAGE_HEIGHT,
  FIELD_INNER_BOTTOM_PADDING,
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
  WORKSPACE_MIN_HEIGHT,
  WORKSPACE_MIN_WIDTH,
  ZOOM_STEP,
  getFitViewportPadding,
  snapToNeighbors,
  type BedViewModel,
  type GraphicalFieldsProps,
  type GuideLine,
  type InteractionMode,
  type Point,
  type RectViewModel,
  type SelectedElement,
} from "./graphicalFieldsGeometry";
import { useGraphicalStageSize } from "./useGraphicalStageSize";
import { AppTooltip } from '../components/AppTooltip';

/** Gap used when auto-arranging beds that do not yet have a saved layout. */
const BED_AUTO_LAYOUT_GAP = DEFAULT_PLACEMENT_SPACING;
/** Minimum spacing kept between a newly placed bed and existing beds. */
const BED_PLACEMENT_SPACING = DEFAULT_PLACEMENT_SPACING;

export default function GraphicalFields({
  showTitle = true,
  interactionMode: controlledInteractionMode,
  onInteractionModeChange,
  showModeToggle = true,
  hierarchyData,
}: GraphicalFieldsProps) {
  const { t } = useTranslation(["fields", "common"]);
  const internalHierarchyData = useHierarchyData(hierarchyData === undefined);
  const { loading, error, locations, fields, beds } = hierarchyData ?? internalHierarchyData;
  const {
    expandedRows: expandedLocationIds,
    hasPersistedState: hasPersistedExpandedState,
    toggleExpand: toggleLocationExpanded,
    ensureExpanded: ensureLocationExpanded,
    expandAll: expandAllLocations,
  } = useExpandedState("graphicalFields");
  const hasInitiallyExpandedRef = useRef(false);
  const [layoutsByBed, setLayoutsByBed] = useState<
    Record<number, BedLayoutEntry>
  >({});
  const [layoutsByField, setLayoutsByField] = useState<
    Record<number, FieldLayoutEntry>
  >({});
  const [activeGuides, setActiveGuides] = useState<GuideLine[]>([]);
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
  const [viewportByLocation, setViewportByLocation] = useState<
    Record<number, ViewportState>
  >({});
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
  const [activePanLocationId, setActivePanLocationId] = useState<number | null>(
    null,
  );
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
  } = useGraphicalStageSize();
  const resetTransientInteractionState = (): void => {
    setActiveGuides([]);
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
    if (
      !hasPersistedExpandedState &&
      !hasInitiallyExpandedRef.current &&
      locations.length > 0
    ) {
      expandAllLocations(
        locations
          .map((location) => location.id)
          .filter((id): id is number => Boolean(id)),
      );
      hasInitiallyExpandedRef.current = true;
    }
  }, [expandAllLocations, hasPersistedExpandedState, locations]);

  useEffect(() => {
    let active = true;
    const loadLayouts = async (): Promise<void> => {
      const locationIds = locations
        .map((location) => location.id)
        .filter((id): id is number => typeof id === "number");
      if (locationIds.length === 0) return;

      try {
        const results = await Promise.all(
          locationIds.map((locationId) => layoutAPI.listByLocation(locationId)),
        );
        if (!active) return;

        setLayoutsByBed((prev) => {
          const next = { ...prev };
          results.forEach((response) => {
            response.data.bed_layouts.forEach((layout) => {
              next[layout.bed] = layout;
            });
          });
          return next;
        });

        setLayoutsByField((prev) => {
          const next = { ...prev };
          results.forEach((response) => {
            response.data.field_layouts.forEach((layout) => {
              next[layout.field] = layout;
            });
          });
          return next;
        });
      } catch (layoutError) {
        console.error("Failed to load bed layouts", layoutError);
      }
    };

    void loadLayouts();
    return () => {
      active = false;
    };
  }, [locations]);

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
  }, [editableLocationId, interactionMode]);

  const isLocationEditMode = (locationId: number): boolean =>
    globalEditMode || editableLocationId === locationId;

  const handleLocationEditToggle = (locationId: number): void => {
    setInteractionMode("view");
    setEditableLocationId((currentLocationId) =>
      currentLocationId === locationId ? null : locationId,
    );
    ensureLocationExpanded(locationId);
  };

  useKeyboardShortcuts(
    [
      {
        id: "graphical-fields.toggle-edit-mode",
        title: t("fields:graphical.editMode"),
        keys: { alt: true, key: "e" },
        contexts: [],
        action: () => {
          if (showModeToggle) {
            setInteractionMode(interactionMode === "edit" ? "view" : "edit");
            return;
          }
          const fallbackLocationId = locationLayouts[0]?.location.id;
          const targetLocationId = activePanLocationId ?? fallbackLocationId ?? null;
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
  ): void => {
    const timerKey = `field-${payload.field}`;
    if (saveTimers.current[timerKey]) {
      window.clearTimeout(saveTimers.current[timerKey]);
    }

    saveTimers.current[timerKey] = window.setTimeout(async () => {
      try {
        await layoutAPI.saveByLocation(locationId, {
          bed_layouts: [],
          field_layouts: [payload],
        });
      } catch (saveError) {
        console.error("Failed to save field layout", saveError);
      }
    }, 250);
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
    const totalFieldsHeight =
      sizedFields.reduce((sum, entry) => sum + entry.height, 0) +
      Math.max(0, sizedFields.length - 1) * LOCATION_FIELD_GAP;
    let fieldY = Math.max(
      LOCATION_LAYOUT_PADDING,
      Math.round(WORKSPACE_MIN_HEIGHT / 2 - totalFieldsHeight / 2),
    );

    const defaultFieldRects = sizedFields.map((entry) => {
      const y = fieldY;
      fieldY += entry.height + LOCATION_FIELD_GAP;
      return {
        ...entry,
        defaultX: Math.max(
          LOCATION_LAYOUT_PADDING,
          Math.round(WORKSPACE_MIN_WIDTH / 2 - entry.width / 2),
        ),
        defaultY: y,
      };
    });

    const contentHeight = Math.max(
      WORKSPACE_MIN_HEIGHT,
      DEFAULT_STAGE_HEIGHT,
      fieldY + 20,
    );
    const contentWidth = Math.max(
      WORKSPACE_MIN_WIDTH,
      ...defaultFieldRects.map(
        (rect) =>
          rect.width + rect.defaultX + LOCATION_LAYOUT_PADDING,
      ),
    );
    const fieldViewModels: RectViewModel[] = defaultFieldRects.map(
      (baseRect) => {
        const fieldId = baseRect.field.id!;
        const savedFieldLayout = layoutsByField[fieldId];
        const clamped = clampInsideParent(
          {
            x: savedFieldLayout?.x ?? baseRect.defaultX,
            y: savedFieldLayout?.y ?? baseRect.defaultY,
          },
          { width: baseRect.width, height: baseRect.height },
          { width: contentWidth, height: contentHeight },
        );

        return {
          id: fieldId,
          x: clamped.x,
          y: clamped.y,
          width: baseRect.width,
          height: baseRect.height,
        };
      },
    );

    return [
      {
        location,
        defaultFieldRects,
        fieldViewModels,
        contentWidth,
        contentHeight,
      },
    ];
  });

  const getContentBoundsForLocation = (locationId: number): ContentBounds => {
    const layout = locationLayouts.find((item) => item.location.id === locationId);
    if (!layout) {
      return toContentBounds({ width: stageWidth, height: stageHeight });
    }

    const fieldBounds = getContentBoundsFromRects(layout.fieldViewModels);
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
      const fitPadding = getFitViewportPadding(stageWidth);
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
      const fitPadding = getFitViewportPadding(stageWidth);
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
    setActivePanLocationId(locationId);
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
    }
  };

  const getFieldInteractionProps = (
    fieldId: number,
    baseRect: (typeof locationLayouts)[number]["defaultFieldRects"][number],
    contentBounds: { width: number; height: number },
    fieldViewModels: RectViewModel[],
    locationName: string,
    locationId: number,
  ) => {
    if (!isLocationEditMode(locationId)) {
      return {
        draggable: false,
        onClick: () => {
          setSelectedElement({
            type: "field",
            name: baseRect.field.name,
            area: Number(baseRect.field.area_sqm ?? 0),
            locationName,
          });
        },
        onTap: () => {
          setSelectedElement({
            type: "field",
            name: baseRect.field.name,
            area: Number(baseRect.field.area_sqm ?? 0),
            locationName,
          });
        },
      };
    }

    return {
      draggable: true,
      onDragMove: (event: KonvaEventObject<Event>) => {
        const raw = { x: event.target.x(), y: event.target.y() };
        const clampedRaw = clampInsideParent(
          raw,
          { width: baseRect.width, height: baseRect.height },
          contentBounds,
        );
        const snapped = snapToNeighbors(
          fieldId,
          clampedRaw,
          { width: baseRect.width, height: baseRect.height },
          fieldViewModels,
          FIELD_SNAP_THRESHOLD,
        );
        const finalClamped = clampInsideParent(
          { x: snapped.x, y: snapped.y },
          { width: baseRect.width, height: baseRect.height },
          contentBounds,
        );
        event.target.position(finalClamped);
        setActiveGuides(snapped.guides);
      },
      onDragEnd: (event: KonvaEventObject<Event>) => {
        const next = clampInsideParent(
          { x: event.target.x(), y: event.target.y() },
          { width: baseRect.width, height: baseRect.height },
          contentBounds,
        );
        const snapped = snapToNeighbors(
          fieldId,
          next,
          { width: baseRect.width, height: baseRect.height },
          fieldViewModels,
          FIELD_SNAP_THRESHOLD,
        );
        const finalClamped = clampInsideParent(
          { x: snapped.x, y: snapped.y },
          { width: baseRect.width, height: baseRect.height },
          contentBounds,
        );
        event.target.position(finalClamped);
        const nextLayout: FieldLayoutEntry = {
          field: fieldId,
          location: locationId,
          x: finalClamped.x,
          y: finalClamped.y,
          version: 1,
        };
        setActiveGuides([]);
        setLayoutsByField((prev) => ({ ...prev, [fieldId]: nextLayout }));
        saveFieldLayout(locationId, nextLayout);
      },
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
  ) => {
    if (!isLocationEditMode(locationId)) {
      return {
        draggable: false,
        onClick: () => {
          setSelectedElement({
            type: "bed",
            name: bedVm.name,
            area: bedVm.area,
            locationName,
            parentName: fieldName,
          });
        },
        onTap: () => {
          setSelectedElement({
            type: "bed",
            name: bedVm.name,
            area: bedVm.area,
            locationName,
            parentName: fieldName,
          });
        },
      };
    }

    return {
      draggable: true,
      onDragMove: (event: KonvaEventObject<Event>) => {
        const raw = {
          x: event.target.x() - (currentFieldRect.x + FIELD_INNER_OFFSET_X),
          y: event.target.y() - (currentFieldRect.y + FIELD_INNER_OFFSET_Y),
        };
        const clampedRaw = clampInsideParent(
          raw,
          { width: bedVm.width, height: bedVm.height },
          fieldInnerSize,
        );
        const snapped = snapToNeighbors(
          bedVm.id,
          clampedRaw,
          { width: bedVm.width, height: bedVm.height },
          bedViewModels,
        );
        const finalClamped = clampInsideParent(
          { x: snapped.x, y: snapped.y },
          { width: bedVm.width, height: bedVm.height },
          fieldInnerSize,
        );
        event.target.position({
          x: currentFieldRect.x + FIELD_INNER_OFFSET_X + finalClamped.x,
          y: currentFieldRect.y + FIELD_INNER_OFFSET_Y + finalClamped.y,
        });
        setActiveGuides(
          snapped.guides.map((guide) => ({
            ...guide,
            value:
              guide.orientation === "vertical"
                ? currentFieldRect.x + FIELD_INNER_OFFSET_X + guide.value
                : currentFieldRect.y + FIELD_INNER_OFFSET_Y + guide.value,
            start:
              guide.orientation === "vertical"
                ? currentFieldRect.y + FIELD_INNER_OFFSET_Y + guide.start
                : currentFieldRect.x + FIELD_INNER_OFFSET_X + guide.start,
            end:
              guide.orientation === "vertical"
                ? currentFieldRect.y + FIELD_INNER_OFFSET_Y + guide.end
                : currentFieldRect.x + FIELD_INNER_OFFSET_X + guide.end,
          })),
        );
      },
      onDragEnd: (event: KonvaEventObject<Event>) => {
        const next = {
          x: event.target.x() - (currentFieldRect.x + FIELD_INNER_OFFSET_X),
          y: event.target.y() - (currentFieldRect.y + FIELD_INNER_OFFSET_Y),
        };
        const clampedNext = clampInsideParent(
          next,
          { width: bedVm.width, height: bedVm.height },
          fieldInnerSize,
        );
        const snapped = snapToNeighbors(
          bedVm.id,
          clampedNext,
          { width: bedVm.width, height: bedVm.height },
          bedViewModels,
        );
        const finalClamped = clampInsideParent(
          { x: snapped.x, y: snapped.y },
          { width: bedVm.width, height: bedVm.height },
          fieldInnerSize,
        );
        event.target.position({
          x: currentFieldRect.x + FIELD_INNER_OFFSET_X + finalClamped.x,
          y: currentFieldRect.y + FIELD_INNER_OFFSET_Y + finalClamped.y,
        });
        const nextLayout: BedLayoutEntry = {
          bed: bedVm.id,
          location: locationId,
          x: finalClamped.x,
          y: finalClamped.y,
          version: 1,
        };
        setActiveGuides([]);
        setLayoutsByBed((prev) => ({ ...prev, [bedVm.id]: nextLayout }));
        saveBedLayout(locationId, nextLayout);
      },
    };
  };

  const handleStageTouchEnd = (locationId: number): void => {
    endPanSession(locationId);
    pinchStateRef.current[locationId] = null;
  };

  const effectiveActivePanLocationId =
    activePanLocationId !== null &&
    locationLayouts.some((layout) => layout.location.id === activePanLocationId)
      ? activePanLocationId
      : (locationLayouts[0]?.location.id ?? null);

  useEffect(() => {
    const isTypingElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tagName = target.tagName.toLowerCase();
      return (
        target.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select"
      );
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isTypingElement(event.target) || effectiveActivePanLocationId === null) {
        return;
      }
      const step = event.shiftKey ? PAN_FAST_STEP : PAN_STEP;
      switch (event.key) {
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [effectiveActivePanLocationId, handlePanByOffset]);

  if (loading) {
    return (
      <Box sx={{ p: { xs: 0, sm: 3 } }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      // This wrapper was the real xs gutter source on Anbauflächen mobile.
      // Keep edge-aligned content on xs and preserve current spacing on sm+.
      sx={{ p: { xs: 0, sm: 3 } }}
    >
      <Stack
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
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {locationLayouts.map(
        ({
          location,
          defaultFieldRects,
          fieldViewModels,
          contentWidth,
          contentHeight,
        }) => {
          if (!location.id) {
            return null;
          }

          const locationId = location.id;
          const contentBounds = getContentBoundsForLocation(locationId);
          const locationIsEditable = isLocationEditMode(locationId);
          const viewport =
            viewportByLocation[locationId] ??
            fitBoundsToStage(
              contentBounds,
              { width: stageWidth, height: stageHeight },
              getFitViewportPadding(stageWidth),
            );
          const visibility = getVisibleElements(viewport.scale);

          return (
            <Accordion
              key={locationId}
              expanded={expandedLocationIds.has(locationId)}
              onChange={() => toggleLocationExpanded(locationId)}
              sx={{
                ...(locationIsEditable
                  ? {
                    borderLeft: 4,
                    borderLeftColor: "success.main",
                    "&:before": { display: "none" },
                  }
                  : {}),
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{
                  ...(locationIsEditable
                    ? {
                      bgcolor: "success.50",
                      "&:hover": { bgcolor: "success.100" },
                    }
                    : {}),
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    flexWrap: "nowrap",
                    gap: 1.5,
                    minWidth: 0,
                    width: "100%",
                    pr: 1,
                  }}
                >
                  <Typography
                    variant="h6"
                    sx={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t("fields:graphical.locationTitle", { name: location.name })}
                  </Typography>
                  {!globalEditMode ? (
                    <>
                      <AppTooltip
                        title={t(
                          locationIsEditable
                            ? "fields:graphical.disableLocationEditMode"
                            : "fields:graphical.enableLocationEditMode",
                          { name: location.name },
                        )}
                      >
                        <Box
                          component="span"
                          role="button"
                          tabIndex={0}
                          aria-label={t(
                            locationIsEditable
                              ? "fields:graphical.disableLocationEditMode"
                              : "fields:graphical.enableLocationEditMode",
                            { name: location.name },
                          )}
                          aria-pressed={locationIsEditable}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleLocationEditToggle(locationId);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            handleLocationEditToggle(locationId);
                          }}
                          sx={{
                            display: { xs: "none", sm: "inline-flex" },
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            gap: 0.75,
                            minHeight: 32,
                            px: 1.25,
                            borderRadius: 1,
                            typography: "button",
                            textTransform: "none",
                            color: locationIsEditable ? "success.contrastText" : "success.dark",
                            bgcolor: locationIsEditable ? "success.main" : "background.paper",
                            border: "1px solid",
                            borderColor: locationIsEditable ? "success.dark" : "success.main",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            boxShadow: locationIsEditable ? 1 : 0,
                            "&:hover": {
                              bgcolor: locationIsEditable ? "success.dark" : "success.50",
                              borderColor: "success.dark",
                            },
                            "&:focus-visible": {
                              outline: "2px solid",
                              outlineColor: "primary.main",
                              outlineOffset: 2,
                            },
                          }}
                        >
                          {locationIsEditable ? (
                            <CheckCircleOutlineIcon fontSize="small" />
                          ) : (
                            <EditOutlinedIcon fontSize="small" />
                          )}
                          {t(
                            locationIsEditable
                              ? "fields:graphical.locationEditModeActive"
                              : "fields:graphical.locationEditModeAction",
                          )}
                        </Box>
                      </AppTooltip>
                      <AppTooltip
                        title={t("fields:graphical.locationEditModeAction")}
                      >
                        <Box
                          component="span"
                          role="button"
                          tabIndex={0}
                          aria-label={t("fields:graphical.locationEditModeAction")}
                          aria-pressed={locationIsEditable}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleLocationEditToggle(locationId);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            handleLocationEditToggle(locationId);
                          }}
                          sx={{
                            display: { xs: "inline-flex", sm: "none" },
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            width: 34,
                            height: 34,
                            borderRadius: "50%",
                            color: locationIsEditable ? "success.contrastText" : "success.dark",
                            bgcolor: locationIsEditable ? "success.main" : "background.paper",
                            border: "1px solid",
                            borderColor: locationIsEditable ? "success.dark" : "success.main",
                            boxShadow: locationIsEditable ? 1 : 0,
                            cursor: "pointer",
                            "&:hover": {
                              bgcolor: locationIsEditable ? "success.dark" : "success.50",
                            },
                            "&:focus-visible": {
                              outline: "2px solid",
                              outlineColor: "primary.main",
                              outlineOffset: 2,
                            },
                          }}
                        >
                          {locationIsEditable ? (
                            <CheckCircleOutlineIcon fontSize="small" />
                          ) : (
                            <EditOutlinedIcon fontSize="small" />
                          )}
                        </Box>
                      </AppTooltip>
                    </>
                  ) : null}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                {locationIsEditable ? (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>
                    {t("fields:graphical.locationEditModeBanner")}
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
                      bgcolor: "background.paper",
                    }}
                  >
                    <Stack spacing={0} sx={{ alignItems: "stretch", }} >
                      <Box sx={{ display: { xs: "none", sm: "block" } }}>
                        <Box sx={{ display: "flex", justifyContent: "center" }}>
                          <AppTooltip title={t("fields:graphical.panUp")} placement="left">
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
                      <AppTooltip
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
                      <AppTooltip
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
                      bgcolor: "rgba(255,255,255,0.78)",
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
                    onMouseEnter={() => setActivePanLocationId(locationId)}
                    onPointerDown={() => setActivePanLocationId(locationId)}
                    ref={(node) => {
                      stageRefs.current[locationId] = node;
                    }}
                  >
                    <Layer>
                      {defaultFieldRects.map((baseRect) => {
                        const fieldId = baseRect.field.id!;
                        const currentFieldRect = fieldViewModels.find(
                          (fieldRect) => fieldRect.id === fieldId,
                        );
                        if (!currentFieldRect) {
                          return null;
                        }

                        const fieldBeds = beds.filter(
                          (bed) =>
                            bed.field === fieldId && bed.id !== undefined,
                        );
                        const bedSizeMap = new Map<number, RectSize>();
                        const fieldInnerSize = {
                          width: baseRect.width - FIELD_INNER_OFFSET_X * 2,
                          height:
                            baseRect.height -
                            FIELD_INNER_OFFSET_Y -
                            FIELD_INNER_BOTTOM_PADDING,
                        };
                        fieldBeds.forEach((bed) => {
                          bedSizeMap.set(
                            bed.id!,
                            getBedRectSizeWithinField(
                              bed,
                              baseRect.field,
                              fieldInnerSize,
                            ),
                          );
                        });

                        const missingBeds = fieldBeds
                          .map((bed) => bed.id!)
                          .filter((bedId) => !layoutsByBed[bedId]);
                        const occupiedBedRects: PlacementRect[] = fieldBeds
                          .filter((bed) => layoutsByBed[bed.id!])
                          .map((bed) => {
                            const bedId = bed.id!;
                            const size = bedSizeMap.get(bedId)!;
                            const saved = layoutsByBed[bedId];
                            const clamped = clampInsideParent(
                              { x: saved.x, y: saved.y },
                              size,
                              fieldInnerSize,
                            );
                            return {
                              x: clamped.x,
                              y: clamped.y,
                              width: size.width,
                              height: size.height,
                            };
                          });
                        const autoLayout = initialAutoLayout(
                          missingBeds,
                          bedSizeMap,
                          fieldInnerSize,
                          BED_AUTO_LAYOUT_GAP,
                          occupiedBedRects,
                          BED_PLACEMENT_SPACING,
                        );
                        const bedViewModels: BedViewModel[] = fieldBeds.map(
                          (bed) => {
                            const bedId = bed.id!;
                            const size = bedSizeMap.get(bedId)!;
                            const saved = layoutsByBed[bedId];
                            const fallback = autoLayout.get(bedId) ?? {
                              x: 10,
                              y: 10,
                            };
                            const clamped = clampInsideParent(
                              {
                                x: saved?.x ?? fallback.x,
                                y: saved?.y ?? fallback.y,
                              },
                              size,
                              fieldInnerSize,
                            );
                            return {
                              id: bedId,
                              name: bed.name,
                              area: Number(bed.area_sqm ?? 0),
                              x: clamped.x,
                              y: clamped.y,
                              width: size.width,
                              height: size.height,
                            };
                          },
                        );

                        return (
                          <Group key={fieldId}>
                            <Rect
                              x={currentFieldRect.x}
                              y={currentFieldRect.y}
                              width={baseRect.width}
                              height={baseRect.height}
                              stroke="#2f855a"
                              strokeWidth={2}
                              cornerRadius={4}
                              name="graphical-editable"
                              data-testid={`field-rect-${fieldId}`}
                              {...getFieldInteractionProps(
                                fieldId,
                                baseRect,
                                { width: contentWidth, height: contentHeight },
                                fieldViewModels,
                                location.name,
                                locationId,
                              )}
                            />
                            {shouldShowFieldLabel(
                              {
                                width: baseRect.width,
                                height: baseRect.height,
                              },
                              viewport.scale,
                            ) ? (
                              <Text
                                x={currentFieldRect.x + 8}
                                y={currentFieldRect.y + 8}
                                text={baseRect.field.name}
                                fontStyle="bold"
                                listening={false}
                                scaleX={1 / viewport.scale}
                                scaleY={1 / viewport.scale}
                              />
                            ) : null}
                            {visibility.showBeds
                              ? bedViewModels.map((bedVm) => (
                                  <Group key={bedVm.id}>
                                    <Rect
                                      x={
                                        currentFieldRect.x +
                                        FIELD_INNER_OFFSET_X +
                                        bedVm.x
                                      }
                                      y={
                                        currentFieldRect.y +
                                        FIELD_INNER_OFFSET_Y +
                                        bedVm.y
                                      }
                                      width={bedVm.width}
                                      height={bedVm.height}
                                      fill="#bee3f8"
                                      stroke="#2b6cb0"
                                      strokeWidth={1}
                                      name="graphical-editable"
                                      data-testid={`bed-rect-${bedVm.id}`}
                                      {...getBedInteractionProps(
                                        bedVm,
                                        currentFieldRect,
                                        fieldInnerSize,
                                        bedViewModels,
                                        location.name,
                                        baseRect.field.name,
                                        locationId,
                                      )}
                                    />
                                    {visibility.showBedLabels &&
                                    shouldShowBedLabel(
                                      {
                                        width: bedVm.width,
                                        height: bedVm.height,
                                      },
                                      viewport.scale,
                                    ) ? (
                                      (() => {
                                        const bedScreenWidth =
                                          bedVm.width * viewport.scale;
                                        const bedScreenHeight =
                                          bedVm.height * viewport.scale;
                                        const shouldUseCompactLabel =
                                          bedScreenWidth < 80 ||
                                          bedScreenHeight < 30;
                                        const labelText =
                                          visibility.showDetailedBedLabels &&
                                          !shouldUseCompactLabel
                                            ? `${bedVm.name} (${bedVm.area || "-"} m²)`
                                            : bedVm.name;
                                        return (
                                          <Text
                                            x={
                                              currentFieldRect.x +
                                              FIELD_INNER_OFFSET_X +
                                              4 +
                                              bedVm.x
                                            }
                                            y={
                                              currentFieldRect.y +
                                              FIELD_INNER_OFFSET_Y +
                                              4 +
                                              bedVm.y
                                            }
                                            text={labelText}
                                            fontSize={
                                              shouldUseCompactLabel ? 11 : 12
                                            }
                                            width={Math.max(
                                              1,
                                              bedScreenWidth - 4,
                                            )}
                                            wrap="word"
                                            listening={false}
                                            scaleX={1 / viewport.scale}
                                            scaleY={1 / viewport.scale}
                                          />
                                        );
                                      })()
                                    ) : null}
                                  </Group>
                                ))
                              : null}
                          </Group>
                        );
                      })}

                      {activeGuides.map((guide, index) => (
                        <Rect
                          key={`${guide.orientation}-${guide.value}-${index}`}
                          x={
                            guide.orientation === "vertical"
                              ? guide.value - 0.75
                              : guide.start
                          }
                          y={
                            guide.orientation === "vertical"
                              ? guide.start
                              : guide.value - 0.75
                          }
                          width={
                            guide.orientation === "vertical"
                              ? 1.5
                              : Math.max(1, guide.end - guide.start)
                          }
                          height={
                            guide.orientation === "vertical"
                              ? Math.max(1, guide.end - guide.start)
                              : 1.5
                          }
                          fill="#e53e3e"
                          opacity={0.8}
                        />
                      ))}
                    </Layer>
                  </Stage>
                </Box>
              </AccordionDetails>
            </Accordion>
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
