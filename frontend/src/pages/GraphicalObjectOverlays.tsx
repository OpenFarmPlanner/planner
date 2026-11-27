import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Box, Button, IconButton, ListItemIcon, MenuItem, Paper, Stack, Typography } from '@mui/material';
import { individualPlantCreationAction } from '../planting-plans/individualPlantActions';
import CloseIcon from '@mui/icons-material/Close';
import { ContextMenuHint } from '../components/data-grid/ContextMenuHint';
import { CustomContextMenu } from '../components/contextMenu/CustomContextMenu';
import { renderGroupedContextMenuActions } from '../components/contextMenu/contextMenuGroups';
import { useContextMenuOpenRegistration } from '../components/contextMenu/contextMenuOpenState';
import { useCloseCustomContextMenuOnNativeContextMenu } from '../utils/contextMenu';
import { GraphicalCropPreview, type CropPreviewData } from './GraphicalCropPreview';
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
import type { ViewportState } from './graphicalViewport';
import { graphicalObjectKey, type GraphicalObjectInteraction } from './useGraphicalObjectInteraction';
import type { BedCultivationEntry, CropReference } from './graphicalCultivation';
import { formatCropOccupation } from './graphicalCropTimeLabels';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';
import type { GraphicalIndividualPlant } from './graphicalIndividualPlants';
import type { IndividualPlacementAction } from './useIndividualPlants';
import { MAX_INDIVIDUAL_POSITIONS } from './individualPlantGeneration';

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

function screenRect(rect: Rect, viewport: ViewportState): Rect {
  return { x: viewport.x + rect.x * viewport.scale, y: viewport.y + rect.y * viewport.scale,
    width: rect.width * viewport.scale, height: rect.height * viewport.scale };
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
  onFocusObject: (rect: Rect) => void;
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

export function GraphicalObjectOverlays({
  interaction, objects, viewport, stageWidth, stageHeight, root, openDetails, onOpenCrop, onStartIndividualPlan,
  canEditPlant, onEditPlant, onFocusObject, bedTasks, plantTasks, cropPreview, cropReference, hoverLayerData, seasonId,
  canComplete, showLocationLabel,
}: OverlayProps) {
  const { t, i18n } = useTranslation(['fields', 'hierarchy', 'common', 'dashboard', 'plantingPlans']);
  const titleId = useId();
  const preview = useRef<HTMLDivElement>(null);
  const keyboardPreview = useRef<HTMLButtonElement | null>(null);
  const targets = useRef(new Map<string, HTMLButtonElement>());
  const selection = interaction.selection ? objects.get(interaction.selection) : null;
  const hovered = interaction.hover ? objects.get(interaction.hover.key) : null;
  const menu = interaction.menu;
  const menuObject = menu ? objects.get(menu.key) : null;
  const individualAction = menuObject && menuObject.type !== 'plant' && onStartIndividualPlan
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

  const keyboardMenu = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    const anchor = trigger.getBoundingClientRect();
    keyboardPreview.current = null;
    interaction.openMenu(key, { x: anchor.left, y: anchor.bottom }, trigger);
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

  const plantPositionLabel = (plant: GraphicalIndividualPlant) => t('individualPlants.positionInPlan', {
    index: numberText(plant.index), total: numberText(plant.count),
  });
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
        { id: 'add-stem', group: 'placement', label: t('individualPlants.newPosition'), disabled: plant.count >= MAX_INDIVIDUAL_POSITIONS,
          activate: () => onEditPlant(plant, 'add') },
        { id: 'remove-stem', group: 'remove', label: t('individualPlants.removePosition'), disabled: plant.count <= 1,
          activate: () => onEditPlant(plant, 'remove') },
      ]),
    ];
  };

  const detailsLabel = t('graphical.objects.viewDetails');
  const noPlantTasks = t('individualPlants.noOpenTasks');
  const selectedRect = selection?.rect ? screenRect(selection.rect, viewport) : null;
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
  const plantTaskDescription = (id: number) => {
    if (!hoverLayerData?.bounds) return undefined;
    if (plantTasks.planTasksFailed) return t('graphical.taskLayer.loadError');
    if (plantTasks.planTasksLoading) return t('common:messages.loading');
    const summary = hoverLayerData.plantSummaries.get(id);
    return summary?.outstanding && summary.urgency
      ? `${bedTaskUrgencyLabel(summary.urgency, t)} · ${t('graphical.taskLayer.outstanding', { count: summary.outstanding })}`
      : noPlantTasks;
  };
  const hoveredPlant = hovered?.type === 'plant' ? hovered : null;
  const hoveredPlantTasks = hoveredPlant && hoverLayerData?.bounds
    ? orderBedTasks((plantTasks.tasksByPlan.get(hoveredPlant.id) ?? []).filter(isOpenTask)) : [];

  return (
    <>
      {[...objects.values()].map(object => {
        const rect = object.rect ? screenRect(object.rect, viewport) : null;
        const visibleLabel = object.type === 'location' && showLocationLabel;
        const active = selection?.key === object.key || menuObject?.key === object.key;
        const x = Math.max(0, Math.min(stageWidth - 36, rect?.x ?? 12));
        const y = Math.max(36, Math.min(stageHeight - 36, rect?.y ?? 50));
        return (
          <Box component="button" type="button" key={object.key}
            ref={(node: HTMLButtonElement | null) => {
              if (node) targets.current.set(object.key, node);
              else targets.current.delete(object.key);
            }}
            data-graphical-object-target={object.key}
            tabIndex={object.type === 'plant' && tabKeys.get(object.id) !== object.key ? -1 : undefined}
            aria-label={object.type === 'plant' ? `${object.name} · ${plantPositionLabel(object)}`
              : `${t(`hierarchy:details.entityType.${object.type}`)} · ${object.name}`}
            aria-description={object.type === 'bed' ? bedTaskDescription(object.id) : object.type === 'plant'
              ? [object.phase, plantTaskDescription(object.id)].filter(Boolean).join(' · ') || undefined : undefined}
            aria-haspopup="menu" aria-keyshortcuts={object.type === 'plant'
              ? 'Shift+F10 ContextMenu ArrowLeft ArrowRight ArrowUp ArrowDown' : 'Shift+F10 ContextMenu'} aria-pressed={active}
            onFocus={() => {
              if (object.type === 'plant') setKeyboardPlants(current => current[object.id] === object.key
                ? current : { ...current, [object.id]: object.key });
              if (!menuObject && rect && (rect.x + rect.width < 0 || rect.y + rect.height < 0
                || rect.x > stageWidth || rect.y > stageHeight) && object.rect) onFocusObject(object.rect);
            }}
            onClick={event => {
              if (event.detail !== 0 && visibleLabel) return;
              keyboardPreview.current = event.currentTarget;
              if (selectedKey === object.key) preview.current?.focus({ preventScroll: true });
              interaction.select(object.key);
            }}
            onKeyDown={event => {
              keyboardMenu(event, object.key);
              if (object.type === 'plant') keyboardPlant(event, object);
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
            sx={{
              position: 'absolute', zIndex: 1, left: x, top: y, borderRadius: 1,
              font: 'inherit', color: 'text.primary', pointerEvents: visibleLabel ? 'auto' : 'none',
              ...(visibleLabel ? {
                minHeight: 36, cursor: 'pointer', border: '1px solid', borderColor: active ? 'success.dark' : 'divider',
                bgcolor: active ? 'success.50' : 'background.paper', px: 1, maxWidth: 'calc(100% - 118px)', overflowWrap: 'anywhere',
              } : {
                width: Math.min(stageWidth - x, Math.max(28, rect?.width ?? 28)),
                height: Math.min(stageHeight - y, Math.max(22, rect?.height ?? 22)),
                overflow: 'hidden', whiteSpace: 'nowrap', color: 'transparent', bgcolor: 'transparent', border: 0,
              }),
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2,
                width: 'auto', height: 'auto', minHeight: 28, opacity: 1, bgcolor: 'background.paper', color: 'text.primary', px: 1 },
            }}>
            {object.name}
          </Box>
        );
      })}
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
          elevation={6} sx={{
            position: 'absolute', zIndex: 3, width: previewWidth, left: beside ? rightOfObject : previewLeft, p: 1.5,
            maxHeight: previewHeight, overflowY: 'auto', touchAction: 'pan-y', overscrollBehavior: 'contain',
            ...previewPlacement,
          }}>
          <Stack spacing={0.5}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography id={titleId} component="h2" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{selection.name}</Typography>
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
            {selection.type === 'plant' && canEditPlant(selection) && <Button size="small" onClick={() => onEditPlant(selection, 'edit')}
              sx={{ alignSelf: 'flex-start', minHeight: 44 }}>{t('individualPlants.editPlants')}</Button>}
            {onStartIndividualPlan && selection.type !== 'plant' && (
              <Button size="small" onClick={() => onStartIndividualPlan(selection)}
                sx={{ alignSelf: 'flex-start', minHeight: 44 }}>{t('individualPlants.newPlan')}</Button>
            )}
          </Stack>
        </Paper>
      )}
      <CustomContextMenu open={Boolean(menuObject)} mouseX={menu?.point.x} mouseY={menu?.point.y}
        keyboardNavigation onClose={closeMenu} container={getGraphicalPortalContainer()} disableRestoreFocus
        listLabel={menuObject?.name}>
        {menuObject?.type === 'plant' ? renderGroupedContextMenuActions(plantMenuActions(menuObject), action => (
          <MenuItem key={action.id} disabled={action.disabled} onClick={action.activate}>{action.label}</MenuItem>
        )) : [
          <MenuItem key="details" onClick={() => { if (menuObject) openDetails(menuObject); }}>{detailsLabel}</MenuItem>,
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
