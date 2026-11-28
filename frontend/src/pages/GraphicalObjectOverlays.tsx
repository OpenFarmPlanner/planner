import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { Box, Button, IconButton, ListItemIcon, MenuItem, Paper, Stack, Typography } from '@mui/material';
import { individualPlantCreationAction } from '../planting-plans/individualPlantActions';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { AppTooltip } from '../components/AppTooltip';
import ZoomInMapOutlinedIcon from '@mui/icons-material/ZoomInMapOutlined';
import { ContextMenuHint } from '../components/data-grid/ContextMenuHint';
import { CustomContextMenu } from '../components/contextMenu/CustomContextMenu';
import { renderGroupedContextMenuActions } from '../components/contextMenu/contextMenuGroups';
import { useContextMenuOpenRegistration } from '../components/contextMenu/contextMenuOpenState';
import { useCloseCustomContextMenuOnNativeContextMenu } from '../utils/contextMenu';
import { GraphicalCropPreview, type CropPreviewData } from './GraphicalCropPreview';
import { SiteSuitabilityHints } from '../components/planting-plans/rotation/SiteSuitabilityHints';
import { GraphicalBedHoverDetails } from './GraphicalBedHoverDetails';
import { BedTaskList } from '../components/tasks/BedTaskList';
import { bedTaskUrgencyLabel, orderBedTasks, type BedTaskSummary, type bedTaskDateBounds } from '../components/tasks/bedTaskUrgency';
import { isOpenTask } from '../components/tasks/taskBoard';
import type { Task } from '../api/types';
import type { HierarchyEntityType } from '../components/hierarchy/details/hierarchyDetailRoutes';
import type { MetricCoverage } from '../components/hierarchy/utils/growingAreaGeometry';
import { useTranslation } from '../i18n';
import { formatDateToAPI } from '../utils/isoDate';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import { resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import type { useBedTasks } from '../components/tasks/useBedTasks';
import type { Rect } from './graphicalLayoutUtils';
import { projectViewportRect, type ViewportState } from './graphicalViewport';
import { graphicalObjectKey, type GraphicalObjectInteraction } from './useGraphicalObjectInteraction';
import type { BedCultivationEntry, CropReference } from './graphicalCultivation';
import { formatCropOccupation } from './graphicalCropTimeLabels';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';
import type { GraphicalIndividualPlant } from './graphicalIndividualPlants';
import type { IndividualPlacementAction } from './useIndividualPlants';
import { individualPositionLimit } from './individualPlantGeneration';

export interface GraphicalAreaObject {
  key: string;
  type: HierarchyEntityType;
  id: number;
  name: string;
  parent?: string;
  metrics: { width_m?: number | null; length_m?: number | null; area_sqm?: number | null };
  rect: Rect | null;
  coverage?: MetricCoverage;
}

export type GraphicalObject = GraphicalAreaObject | GraphicalIndividualPlant;

const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const numberText = (value: number) => formatLocalizedNumber(value, getActiveFormattingLocale(), { maximumFractionDigits: 2 });

function ObjectFacts({ object, compact = false }: { object: GraphicalAreaObject; compact?: boolean }) {
  const { t } = useTranslation(['fields', 'hierarchy', 'common']);
  const width = positive(object.metrics.width_m);
  const length = positive(object.metrics.length_m);
  const area = positive(object.metrics.area_sqm) ?? (width && length ? width * length : null);
  const areaText = (value: number) => `${numberText(value)} ${t('common:units.squareMeters')}`;
  const coverage = object.coverage;
  return (
    <>
      {!compact && object.parent && <Typography variant="caption" color="text.secondary">
        {t(object.type === 'bed' ? 'graphical.parentField' : 'graphical.location')}: {object.parent}
      </Typography>}
      {width !== null && length !== null ? <Typography variant="caption">
        {t('graphical.objects.dimensions', { width: numberText(width), length: numberText(length) })}
      </Typography> : (width ?? length) !== null && <Typography variant="caption">
        {t(width !== null ? 'hierarchy:columns.width' : 'hierarchy:columns.length')}: {numberText((width ?? length)!)}
      </Typography>}
      {area !== null && <Typography variant="caption">{t('graphical.area')}: {areaText(area)}</Typography>}
      {!compact && coverage?.footprintArea != null && coverage.remainingArea !== null && (
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 0.25, columnGap: 1, m: 0 }}>
          <Typography component="dt" variant="caption">{t(object.type === 'location'
            ? 'hierarchy:details.coverage.parcelFootprint' : 'hierarchy:details.coverage.bedFootprint')}</Typography>
          <Typography component="dd" variant="caption" sx={{ m: 0 }}>{areaText(coverage.footprintArea)}</Typography>
          <Typography component="dt" variant="caption">{t(object.type === 'location'
            ? 'hierarchy:details.coverage.outsideParcels' : 'hierarchy:details.coverage.withoutBeds')}</Typography>
          <Typography component="dd" variant="caption" sx={{ m: 0 }}>{areaText(coverage.remainingArea)}</Typography>
        </Box>
      )}
    </>
  );
}

interface OverlayProps {
  interaction: GraphicalObjectInteraction;
  objects: ReadonlyMap<string, GraphicalObject>;
  viewport: ViewportState;
  stageWidth: number;
  stageHeight: number;
  root: RefObject<HTMLDivElement | null>;
  openDetails: (object: GraphicalObject) => void;
  onOpenCrop?: (id: number) => void;
  onStartIndividualPlan?: (object: GraphicalAreaObject) => void;
  canEditPlant: (plant: GraphicalIndividualPlant) => boolean;
  onEditPlant: (plant: GraphicalIndividualPlant, action: IndividualPlacementAction) => void;
  /** Starts the validated removal of the selected plant; absent for read-only access. */
  onRemovePlant?: (plant: GraphicalIndividualPlant) => void;
  /** Multi-selection of individual plants: Shift+Enter or, while active, Enter toggles a plant. */
  plantMultiSelect?: {
    active: boolean;
    selected: ReadonlySet<string>;
    toggle: (key: string) => void;
    start: (key: string) => void;
  };
  onFocusObject: (rect: Rect) => void;
  onZoomObject: (rect: Rect) => void;
  zoomOnly?: boolean;
  bedTasks: ReturnType<typeof useBedTasks>;
  plantTasks: ReturnType<typeof useBedTasks>;
  cropPreview?: CropPreviewData;
  cropReference?: CropReference;
  hoverLayerData?: {
    byBed: ReadonlyMap<number, readonly Task[]>;
    summaries: ReadonlyMap<number, BedTaskSummary>;
    plantSummaries: ReadonlyMap<number, BedTaskSummary>;
    bounds?: ReturnType<typeof bedTaskDateBounds>;
    crops?: ReadonlyMap<number, readonly BedCultivationEntry[]>;
    cropLoading: boolean;
    cropFailed: boolean;
  };
  seasonId?: number;
  canComplete: boolean;
  showLocationLabel: boolean;
}

const isGraphicalMenu = (target: EventTarget | null) => target instanceof Element
  && Boolean(target.closest('[data-graphical-object-target], .konvajs-content'));

const objectTargetsSx = {
  display: 'contents',
  '& > [data-graphical-object-target]': {
    position: 'absolute', zIndex: 1, left: 'var(--target-x)', top: 'var(--target-y)', borderRadius: 1,
    width: 'var(--target-width)', height: 'var(--target-height)', font: 'inherit', pointerEvents: 'none',
    overflow: 'hidden', whiteSpace: 'nowrap', color: 'transparent', bgcolor: 'transparent', border: 0,
    '&[data-graphical-location-label]': {
      width: 'auto', height: 'auto', minHeight: 36, pointerEvents: 'auto', cursor: 'pointer', border: '1px solid',
      borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary', px: 1,
      maxWidth: 'calc(100% - 118px)', whiteSpace: 'normal', overflowWrap: 'anywhere',
      '&[aria-pressed="true"]': { borderColor: 'success.dark', bgcolor: 'success.50' },
    },
    '&:focus-visible': {
      outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2,
      left: 'min(var(--target-x), max(8px, calc(100% - 268px)))',
      top: 'min(var(--target-y), max(36px, calc(100% - 168px)))',
      width: 'auto', height: 'auto', minHeight: 28, maxWidth: 'min(260px, calc(100% - 16px))',
      whiteSpace: 'normal', overflowWrap: 'anywhere', bgcolor: 'background.paper', color: 'text.primary', px: 1,
    },
  },
} as const;

export function GraphicalObjectOverlays({
  interaction, objects, viewport, stageWidth, stageHeight, root, openDetails, onOpenCrop, onStartIndividualPlan,
  canEditPlant, onEditPlant, onRemovePlant, plantMultiSelect, onFocusObject, onZoomObject, zoomOnly, bedTasks, plantTasks, cropPreview, cropReference, hoverLayerData, seasonId,
  canComplete, showLocationLabel,
}: OverlayProps) {
  const { t, i18n } = useTranslation(['fields', 'hierarchy', 'common', 'dashboard', 'plantingPlans']);
  const titleId = useId();
  const preview = useRef<HTMLDivElement>(null);
  const keyboardPreview = useRef<HTMLButtonElement | null>(null);
  const zoomFocus = useRef<HTMLElement | null>(null);
  const targets = useRef(new Map<string, HTMLButtonElement>());
  const selection = interaction.selection ? objects.get(interaction.selection) : null;
  const hovered = interaction.hover ? objects.get(interaction.hover.key) : null;
  const menu = interaction.menu;
  const candidate = menu ? objects.get(menu.key) : null;
  const menuObject = zoomOnly && candidate?.type === 'location' ? null : candidate;
  const zoomTarget = menuObject?.type === 'bed' || menuObject?.type === 'field' ? menuObject.rect : null;
  const individualAction = !zoomOnly && menuObject && menuObject.type !== 'plant' && onStartIndividualPlan
    ? individualPlantCreationAction(t, () => onStartIndividualPlan(menuObject)) : null;
  const [keyboardPlants, setKeyboardPlants] = useState<Record<number, string>>({});
  const plantsByPlan = useMemo(() => {
    const result = new Map<number, GraphicalIndividualPlant[]>();
    for (const object of objects.values()) {
      if (object.type !== 'plant') continue;
      const current = result.get(object.id);
      if (current) current.push(object);
      else result.set(object.id, [object]);
    }
    return result;
  }, [objects]);
  const tabKeys = useMemo(() => new Map([...plantsByPlan].map(([id, plants]) => [id,
    (plants.find(plant => plant.key === keyboardPlants[id]) ?? plants[0]).key])), [plantsByPlan, keyboardPlants]);
  const { close } = interaction;
  const closeMenu = () => {
    close();
    if (menu) (menu.trigger ?? targets.current.get(menu.key))?.focus({ preventScroll: true });
  };
  useContextMenuOpenRegistration(Boolean(menuObject));
  useCloseCustomContextMenuOnNativeContextMenu(Boolean(menuObject), closeMenu, isGraphicalMenu);

  const selectedKey = selection?.key;
  useEffect(() => {
    if (selectedKey && keyboardPreview.current) preview.current?.focus({ preventScroll: true });
  }, [selectedKey]);

  useEffect(() => {
    if (!selection) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || preview.current?.contains(event.target)) return;
      if (event.target.closest('[data-graphical-crop-time]')) return;
      keyboardPreview.current = null;
      if (!event.target.closest('.konvajs-content, [data-graphical-object-target]')) close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      event.preventDefault();
      close();
      keyboardPreview.current?.focus({ preventScroll: true });
      keyboardPreview.current = null;
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selection, close]);

  const openMenuFromTarget = (trigger: HTMLButtonElement, key: string) => {
    const anchor = trigger.getBoundingClientRect();
    keyboardPreview.current = null;
    interaction.openMenu(key, { x: anchor.left, y: anchor.bottom }, trigger);
  };
  const keyboardMenu = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    openMenuFromTarget(event.currentTarget, key);
  };

  const keyboardPlant = (event: KeyboardEvent<HTMLButtonElement>, plant: GraphicalIndividualPlant) => {
    const related = plantsByPlan.get(plant.id) ?? [];
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    if (!direction || related.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    const next = (related.indexOf(plant) + direction + related.length) % related.length;
    targets.current.get(related[next].key)?.focus({ preventScroll: true });
  };

  const plantPositionLabel = useCallback((plant: GraphicalIndividualPlant) => t('individualPlants.positionInPlan', {
    index: numberText(plant.index), total: numberText(plant.count),
  }), [t]);
  const plantTargetLabels = useMemo(() => new Map<string, string>([...plantsByPlan.values()].flatMap(plants =>
    plants.map(plant => [plant.key, `${plant.name} · ${plantPositionLabel(plant)}`] as const))), [plantsByPlan, plantPositionLabel]);
  const plantFacts = (plant: GraphicalIndividualPlant, compact = false) => {
    const parent = objects.get(graphicalObjectKey(plant.parent.kind, plant.parent.id));
    const occupation = cropReference?.kind === 'range' && plant.cropProjected
      ? formatCropOccupation(plant.crop.plan, resolveSeasonDateLocale(i18n), t) : null;
    const outside = Boolean(cropReference && !plant.cropProjected && hoverLayerData?.bounds);
    return <>
      <Typography variant="caption">{plantPositionLabel(plant)}</Typography>
      {plant.phase && <Typography variant="caption" color="text.secondary">{plant.phase}</Typography>}
      {occupation && <Typography variant="caption" color="text.secondary">{occupation}</Typography>}
      {outside && <Typography variant="caption" color="text.secondary">{t('graphical.display.outsideCropPeriod')}</Typography>}
      {!compact && parent && <Typography variant="caption" color="text.secondary">{parent.name}</Typography>}
      {!compact && <PlantCounts plant={plant} />}
      {!compact && <SiteSuitabilityHints findings={plant.plan.site_suitability_findings} scope={plant.parent.kind} />}
    </>;
  };
  const plantMenuActions = (plant: GraphicalIndividualPlant) => {
    const editAllowed = canEditPlant(plant);
    const crop = plant.plan.crop;
    return [
      { id: 'plan-details', group: 'details', label: t('plantingPlans:details.title'), activate: () => openDetails(plant) },
      { id: 'view-crop', group: 'details', label: t('plantingPlans:details.openCrop'), disabled: crop === null || !onOpenCrop,
        activate: () => { if (crop !== null) onOpenCrop?.(crop); } },
      ...(!editAllowed ? [] : [
        { id: 'edit-stems', group: 'placement', label: t('individualPlants.editPlants'), activate: () => onEditPlant(plant, 'edit') },
        { id: 'add-stem', group: 'placement', label: t('individualPlants.newPosition'), disabled: plant.count >= individualPositionLimit(plant.plan.individual_count),
          activate: () => onEditPlant(plant, 'add') },
      ]),
      ...(editAllowed && onRemovePlant ? [{ id: 'remove-plant', group: 'remove', label: t('individualPlants.removal.title'),
        activate: () => { close(); onRemovePlant(plant); } }] : []),
    ];
  };

  // Delete (Entf) removes only the exact focused or selected plant, never from a text field or a held key.
  const removeWithDeleteKey = (event: KeyboardEvent<HTMLElement>, plant: GraphicalIndividualPlant) => {
    if (event.key !== 'Delete' || event.repeat || !onRemovePlant || !canEditPlant(plant)) return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    onRemovePlant(plant);
  };

  const detailsLabel = t('graphical.objects.viewDetails');
  const noPlantTasks = t('individualPlants.noOpenTasks');
  const selectedRect = selection?.rect ? projectViewportRect(selection.rect, viewport) : null;
  const narrow = stageWidth < 650 || interaction.device === 'touch';
  const cropDateDiffers = cropPreview && (cropPreview.reference.kind !== 'date'
    || cropPreview.reference.date !== formatDateToAPI(new Date()));
  const previewWidth = Math.min(320, Math.max(124, stageWidth - (narrow && selection?.type === 'plant' ? 72 : 120)));
  const cx = selectedRect ? selectedRect.x + selectedRect.width / 2 : 12;
  const below = selectedRect ? selectedRect.y + selectedRect.height + 8 : 50;
  const previewLeft = narrow ? 8 : Math.max(8, Math.min(stageWidth - previewWidth - 110, cx - previewWidth / 2));
  const rightOfObject = selectedRect ? selectedRect.x + selectedRect.width + 8 : 12;
  const beside = !narrow && selectedRect && rightOfObject + previewWidth + 105 < stageWidth;
  const previewMaxHeight = Math.min(stageHeight * 0.55, 360);
  const previewPlacement = narrow ? { bottom: 8 }
    : beside ? { top: Math.max(8, Math.min(stageHeight - previewMaxHeight - 8, selectedRect.y)) }
      : below < stageHeight / 2 ? { top: Math.max(48, below) }
        : { bottom: Math.max(8, Math.min(stageHeight * 0.45, stageHeight - (selectedRect?.y ?? stageHeight) + 8)) };
  const previewOffset = previewPlacement.top ?? previewPlacement.bottom ?? 0;
  const previewHeight = Math.max(0, Math.min(previewMaxHeight, stageHeight - previewOffset - 8));
  const pointer = interaction.hover?.point;
  const canvas = pointer && hovered ? root.current?.getBoundingClientRect() : undefined;
  const tooltipWidth = Math.min(264, stageWidth - 16);
  const tooltipY = pointer && canvas ? pointer.y - canvas.top : 0;
  const hoverBelow = tooltipY < stageHeight / 2;
  const detailedTooltip = hoverLayerData && (hovered?.type === 'bed' || hovered?.type === 'plant');
  const tooltipOffset = Math.max(8, Math.min(stageHeight - (detailedTooltip ? cropReference?.kind === 'range' ? 330 : 260 : 100),
    hoverBelow ? tooltipY + 14 : stageHeight - tooltipY + 8));
  const tooltipHeight = Math.max(0, stageHeight - tooltipOffset - 8);
  const bedTaskDescription = (id: number) => {
    if (!hoverLayerData?.bounds) return undefined;
    if (bedTasks.failed) return t('graphical.taskLayer.loadError');
    if (bedTasks.loading) return t('common:messages.loading');
    const summary = hoverLayerData.summaries.get(id);
    if (!summary?.outstanding || !summary.urgency) return t('graphical.objects.noOpenTasks');
    return `${bedTaskUrgencyLabel(summary.urgency, t)} · ${t('graphical.taskLayer.outstanding', { count: summary.outstanding })}`;
  };
  const includeTaskDescriptions = Boolean(hoverLayerData?.bounds);
  const plantSummaries = hoverLayerData?.plantSummaries;
  const taskLoadDescription = plantTasks.planTasksFailed ? t('graphical.taskLayer.loadError')
    : plantTasks.planTasksLoading ? t('common:messages.loading') : null;
  const plantTaskDescriptions = useMemo(() => new Map<number, string>(includeTaskDescriptions ? [...plantsByPlan.keys()].map(id => {
    const summary = plantSummaries?.get(id);
    const description = taskLoadDescription ?? (summary?.outstanding && summary.urgency
      ? `${bedTaskUrgencyLabel(summary.urgency, t)} · ${t('graphical.taskLayer.outstanding', { count: summary.outstanding })}`
      : noPlantTasks);
    return [id, description] as const;
  }) : []), [includeTaskDescriptions, noPlantTasks, plantSummaries, plantsByPlan, t, taskLoadDescription]);
  const hoveredPlant = hovered?.type === 'plant' ? hovered : null;
  const hoveredPlantTasks = hoveredPlant && hoverLayerData?.bounds
    ? orderBedTasks((plantTasks.tasksByPlan.get(hoveredPlant.id) ?? []).filter(isOpenTask)) : [];

  return (
    <>
      <Box sx={objectTargetsSx}>{[...objects.values()].map(object => {
        if (zoomOnly && (object.type === 'location' || object.type === 'plant' || !object.rect)) return null;
        const rect = object.rect ? projectViewportRect(object.rect, viewport) : null;
        const visibleLabel = object.type === 'location' && showLocationLabel;
        const active = selection?.key === object.key || menuObject?.key === object.key
          || Boolean(object.type === 'plant' && plantMultiSelect?.selected.has(object.key));
        const x = visibleLabel ? 12 : Math.max(0, Math.min(stageWidth - 36, rect?.x ?? 12));
        const y = visibleLabel ? 50 : Math.max(36, Math.min(stageHeight - 36, rect?.y ?? 50));
        return (
          <button type="button" key={object.key}
            ref={(node: HTMLButtonElement | null) => {
              if (node) targets.current.set(object.key, node);
              else targets.current.delete(object.key);
            }}
            data-graphical-object-target={object.key}
            data-graphical-annotation-obstacle={visibleLabel || undefined}
            data-graphical-location-label={visibleLabel || undefined}
            tabIndex={object.type === 'plant' && tabKeys.get(object.id) !== object.key ? -1 : undefined}
            aria-label={object.type === 'plant' ? plantTargetLabels.get(object.key)
              : `${t(`hierarchy:details.entityType.${object.type}`)} · ${object.name}`}
            aria-description={!zoomOnly && object.type === 'bed' ? bedTaskDescription(object.id) : object.type === 'plant'
              ? [object.phase, plantTaskDescriptions.get(object.id)].filter(Boolean).join(' · ') || undefined : undefined}
            aria-haspopup="menu" aria-keyshortcuts={object.type === 'plant'
              ? 'Shift+F10 ContextMenu ArrowLeft ArrowRight ArrowUp ArrowDown' : 'Shift+F10 ContextMenu'} aria-pressed={active}
            onFocus={() => {
              if (object.type === 'plant') setKeyboardPlants(current => current[object.id] === object.key
                ? current : { ...current, [object.id]: object.key });
              if (!visibleLabel && !menuObject && rect && (rect.x + rect.width < 0 || rect.y + rect.height < 0
                || rect.x > stageWidth || rect.y > stageHeight) && object.rect) onFocusObject(object.rect);
            }}
            onClick={event => {
              if (zoomOnly) {
                if (event.detail === 0) openMenuFromTarget(event.currentTarget, object.key);
                return;
              }
              if (event.detail !== 0 && visibleLabel) return;
              if (object.type === 'plant' && plantMultiSelect
                && (plantMultiSelect.active || event.shiftKey || plantMultiSelect.selected.size > 0)) {
                plantMultiSelect.toggle(object.key);
                return;
              }
              keyboardPreview.current = event.currentTarget;
              if (selectedKey === object.key) preview.current?.focus({ preventScroll: true });
              interaction.select(object.key);
            }}
            onKeyDown={event => {
              keyboardMenu(event, object.key);
              if (object.type === 'plant') {
                keyboardPlant(event, object);
                removeWithDeleteKey(event, object);
              }
            }}
            onPointerDown={event => {
              if (!visibleLabel || event.button !== 0 || !event.isPrimary) return;
              keyboardPreview.current = null;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              interaction.begin(object.key, { x: event.clientX, y: event.clientY },
                event.pointerType === 'touch' ? 'touch' : 'desktop');
            }}
            onPointerEnter={event => {
              if (visibleLabel && event.pointerType !== 'touch' && !event.buttons) {
                interaction.hoverObject(object.key, { x: event.clientX, y: event.clientY });
              }
            }}
            onPointerLeave={() => { if (visibleLabel) interaction.clearHover(); }}
            onPointerMove={event => {
              if (visibleLabel && event.buttons) interaction.moved({ x: event.clientX, y: event.clientY });
            }}
            onPointerUp={event => {
              if (visibleLabel && event.button === 0) interaction.release(object.key, { x: event.clientX, y: event.clientY });
            }}
            onPointerCancel={interaction.cancelPress}
            onContextMenu={event => {
              if (!visibleLabel) return;
              event.preventDefault();
              const { pointerType } = event.nativeEvent as PointerEvent;
              if (pointerType === 'touch' || (!pointerType && interaction.didLongPress())) return;
              interaction.noteDevice('desktop');
              interaction.openMenu(object.key, { x: event.clientX, y: event.clientY }, event.currentTarget, 'desktop');
            }}
            style={{
              '--target-x': `${x}px`, '--target-y': `${y}px`,
              '--target-width': `${Math.min(stageWidth - x, Math.max(28, rect?.width ?? 28))}px`,
              '--target-height': `${Math.min(stageHeight - y, Math.max(22, rect?.height ?? 22))}px`,
            } as CSSProperties}>
            {object.name}
          </button>
        );
      })}</Box>
      {hovered && pointer && canvas && (
        <Paper role="tooltip" elevation={4} sx={{ position: 'absolute', pointerEvents: 'none', zIndex: 3, p: 1,
          left: Math.max(8, Math.min(stageWidth - tooltipWidth - 8, pointer.x - canvas.left + 12)),
          [hoverBelow ? 'top' : 'bottom']: tooltipOffset,
          width: 'max-content', maxWidth: tooltipWidth, maxHeight: tooltipHeight,
          overflow: 'hidden', overflowWrap: 'anywhere',
          '& .MuiTypography-caption': { lineHeight: 1.4 },
        }}>
          <Stack><Typography variant="body2" sx={{ fontWeight: 700 }}>{hovered.name}</Typography>
            {hovered.type === 'plant' ? plantFacts(hovered, true) : <ObjectFacts object={hovered} compact />}
            {hovered.type === 'bed' && hoverLayerData && <GraphicalBedHoverDetails
              tasks={hoverLayerData.byBed.get(hovered.id) ?? []}
              taskLoading={Boolean(hoverLayerData.bounds) && bedTasks.loading} taskFailed={bedTasks.failed}
              taskBounds={hoverLayerData.bounds} crops={hoverLayerData.crops?.get(hovered.id)}
              showOccupation={cropReference?.kind === 'range'}
              taskLimit={tooltipHeight >= 240 ? 3 : tooltipHeight >= 190 ? 2 : 1}
              cropLoading={hoverLayerData.cropLoading} cropFailed={hoverLayerData.cropFailed} />}
            {hoveredPlant && hoverLayerData?.bounds && <GraphicalBedHoverDetails tasks={hoveredPlantTasks}
              taskLoading={plantTasks.planTasksLoading} taskFailed={plantTasks.planTasksFailed} taskBounds={hoverLayerData.bounds}
              taskLimit={tooltipHeight >= 240 ? 3 : tooltipHeight >= 190 ? 2 : 1} noOpenTasksLabel={noPlantTasks}
              cropLoading={false} cropFailed={false} />}
          </Stack>
        </Paper>
      )}
      {selection && (
        <Paper ref={preview} tabIndex={-1} role="region" aria-labelledby={titleId} data-testid="graphical-object-preview"
          onKeyDown={selection.type === 'plant' ? event => removeWithDeleteKey(event, selection) : undefined}
          elevation={6} sx={{
            position: 'absolute', zIndex: 3, width: previewWidth, left: beside ? rightOfObject : previewLeft, p: 1.5,
            maxHeight: previewHeight, overflowY: 'auto', touchAction: 'pan-y', overscrollBehavior: 'contain',
            ...previewPlacement,
          }}>
          <Stack spacing={0.5}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography id={titleId} component="h2" variant="subtitle2" sx={{ overflowWrap: 'anywhere', flex: 1 }}>{selection.name}</Typography>
              {selection.type === 'plant' && onRemovePlant && canEditPlant(selection) && (
                <AppTooltip title={t('individualPlants.removal.title')}>
                  <IconButton size="small" color="error" aria-label={t('individualPlants.removal.title')} aria-keyshortcuts="Delete"
                    onClick={() => onRemovePlant(selection)} sx={{ width: 36, height: 36 }}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </AppTooltip>
              )}
              <IconButton size="small" aria-label={t('common:actions.close')} onClick={() => {
                close();
                (keyboardPreview.current ?? targets.current.get(selection.key))?.focus({ preventScroll: true });
                keyboardPreview.current = null;
              }} sx={{ width: 36, height: 36 }}><CloseIcon fontSize="small" /></IconButton>
            </Stack>
            {selection.type === 'plant' ? plantFacts(selection) : <ObjectFacts object={selection} />}
            {selection.type === 'bed' && cropPreview && <GraphicalCropPreview {...cropPreview} />}
            {selection.type === 'bed' && seasonId !== undefined && (
              <>
                {cropDateDiffers && <Typography variant="caption" color="text.secondary">
                  {t('graphical.display.taskDateNote')}
                </Typography>}
                <BedTaskList key={`${selection.id}:${seasonId}`} tasks={bedTasks.tasksByBed.get(selection.id) ?? []}
                  loading={bedTasks.loading} failed={bedTasks.failed} refresh={bedTasks.refresh}
                  canComplete={canComplete} onOpenDetails={() => openDetails(selection)} />
              </>
            )}
            {selection.type === 'plant' && seasonId !== undefined && <BedTaskList key={`plant:${selection.id}:${seasonId}`}
              tasks={plantTasks.tasksByPlan.get(selection.id) ?? []} loading={plantTasks.planTasksLoading}
              failed={plantTasks.planTasksFailed} refresh={plantTasks.refresh} canComplete={canComplete}
              noOpenTasksLabel={noPlantTasks} onOpenDetails={() => openDetails(selection)} />}
            <Button size="small" onClick={() => openDetails(selection)} sx={{ alignSelf: 'flex-start', minHeight: 44 }}>
              {selection.type === 'plant' ? t('plantingPlans:details.title') : detailsLabel}</Button>
            {selection.type === 'plant' && canEditPlant(selection) && (
              <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                <Button size="small" variant="outlined" onClick={() => onEditPlant(selection, 'edit')}
                  sx={{ minHeight: 44 }}>{t('individualPlants.edit')}</Button>
                {plantMultiSelect && (
                  <Button size="small" onClick={() => { plantMultiSelect.start(selection.key); close(); }}
                    sx={{ minHeight: 44 }}>{t('individualPlants.selection.start')}</Button>
                )}
                {(selection.plan.pending_plants_count ?? 0) > 0 && (
                  <Button size="small" onClick={() => onEditPlant(selection, 'add')} sx={{ minHeight: 44 }}>
                    {t('individualPlants.placePending')}</Button>
                )}
              </Stack>
            )}
            {onStartIndividualPlan && selection.type !== 'plant' && (
              <Button size="small" onClick={() => onStartIndividualPlan(selection)}
                sx={{ alignSelf: 'flex-start', minHeight: 44 }}>{t('individualPlants.addPlants')}</Button>
            )}
          </Stack>
        </Paper>
      )}
      <CustomContextMenu open={Boolean(menuObject)} mouseX={menu?.point.x} mouseY={menu?.point.y}
        keyboardNavigation onClose={closeMenu} container={getGraphicalPortalContainer()} disableRestoreFocus
        onTransitionExited={() => {
          const target = zoomFocus.current;
          zoomFocus.current = null;
          if (target?.isConnected) target.focus({ preventScroll: true });
        }}
        listLabel={menuObject?.name}>
        {menuObject?.type === 'plant' ? renderGroupedContextMenuActions(plantMenuActions(menuObject), action => (
          <MenuItem key={action.id} disabled={action.disabled} onClick={action.activate}>{action.label}</MenuItem>
        )) : [
          !zoomOnly && <MenuItem key="details" onClick={() => { if (menuObject) openDetails(menuObject); }}>{detailsLabel}</MenuItem>,
          zoomTarget && <MenuItem key="zoom" onClick={() => {
            if (menu) zoomFocus.current = menu.trigger ?? targets.current.get(menu.key) ?? null;
            onZoomObject(zoomTarget);
            close();
          }}>
            <ListItemIcon><ZoomInMapOutlinedIcon fontSize="small" /></ListItemIcon>{t('graphical.zoomToArea')}
          </MenuItem>,
          individualAction && <MenuItem key={individualAction.id} onClick={individualAction.onClick}>
            <ListItemIcon>{individualAction.icon}</ListItemIcon>{individualAction.label}
          </MenuItem>,
        ]}
      </CustomContextMenu>
    </>
  );
}

export function GraphicalObjectHint({ device, onClose }: {
  device: 'touch' | 'desktop';
  onClose: () => void;
}) {
  const { t } = useTranslation('fields');
  return <ContextMenuHint compact variant={device} ignorePointerAndViewport
    message={t(device === 'touch' ? 'graphical.objects.touchHint' : 'graphical.objects.desktopHint')}
    onClose={onClose} sx={{
      position: 'absolute', bottom: 52, left: 0, pointerEvents: 'auto',
      maxWidth: 'min(680px, calc(100% - 112px))',
    }} />;
}

function PlantCounts({ plant }: { plant: GraphicalIndividualPlant }) {
  const { t } = useTranslation('fields');
  const positioned = plant.plan.individual_positions?.length ?? plant.count;
  const total = plant.plan.individual_count ?? plant.plan.plants_count ?? positioned;
  const pending = plant.plan.pending_plants_count ?? Math.max(0, total - positioned);
  const canopy = Number(plant.plan.estimated_canopy_diameter_m ?? 0);
  const spacing = Number(plant.plan.recommended_plant_spacing_m ?? 0);
  return <>
    <Typography variant="caption" data-testid="individual-plant-counts">
      {t('individualPlants.positionedOfTotal', { positioned: numberText(positioned), total: numberText(total) })}
      {pending > 0 && ` · ${t('individualPlants.pendingCount', { count: pending, formatted: numberText(pending) })}`}
    </Typography>
    {canopy > 0 && <Typography variant="caption" color="text.secondary">
      {t('individualPlants.canopyValue', { distance: numberText(canopy) })}</Typography>}
    {spacing > 0 && <Typography variant="caption" color="text.secondary">
      {t('individualPlants.spacing', { distance: numberText(spacing) })}</Typography>}
  </>;
}
