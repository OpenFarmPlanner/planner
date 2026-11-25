import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react';
import { Box, Button, IconButton, MenuItem, Paper, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { ContextMenuHint } from '../components/data-grid/ContextMenuHint';
import { CustomContextMenu } from '../components/contextMenu/CustomContextMenu';
import { useContextMenuOpenRegistration } from '../components/contextMenu/contextMenuOpenState';
import { useCloseCustomContextMenuOnNativeContextMenu } from '../utils/contextMenu';
import { GraphicalCropPreview, type CropPreviewData } from './GraphicalCropPreview';
import { BedTaskList } from '../components/tasks/BedTaskList';
import type { HierarchyEntityType } from '../components/hierarchy/details/hierarchyDetailRoutes';
import type { MetricCoverage } from '../components/hierarchy/utils/growingAreaGeometry';
import { useTranslation } from '../i18n';
import { formatDateToAPI } from '../utils/isoDate';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import type { useBedTasks } from '../components/tasks/useBedTasks';
import type { Rect } from './graphicalLayoutUtils';
import type { ViewportState } from './graphicalViewport';
import type { GraphicalObjectInteraction } from './useGraphicalObjectInteraction';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';

export interface GraphicalObject {
  key: string;
  type: HierarchyEntityType;
  id: number;
  name: string;
  parent?: string;
  metrics: { width_m?: number | null; length_m?: number | null; area_sqm?: number | null };
  rect: Rect | null;
  coverage?: MetricCoverage;
}

const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const numberText = (value: number) => formatLocalizedNumber(value, getActiveFormattingLocale(), { maximumFractionDigits: 2 });

function ObjectFacts({ object, compact = false }: { object: GraphicalObject; compact?: boolean }) {
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
  onFocusObject: (rect: Rect) => void;
  bedTasks: ReturnType<typeof useBedTasks>;
  cropPreview?: CropPreviewData;
  seasonId?: number;
  canComplete: boolean;
  showLocationLabel: boolean;
}

const isGraphicalMenu = (target: EventTarget | null) => target instanceof Element
  && Boolean(target.closest('[data-graphical-object-target], .konvajs-content'));

export function GraphicalObjectOverlays({
  interaction, objects, viewport, stageWidth, stageHeight, root, openDetails, onFocusObject,
  bedTasks, cropPreview, seasonId, canComplete, showLocationLabel,
}: OverlayProps) {
  const { t } = useTranslation(['fields', 'hierarchy', 'common']);
  const titleId = useId();
  const preview = useRef<HTMLDivElement>(null);
  const keyboardPreview = useRef<HTMLButtonElement | null>(null);
  const targets = useRef(new Map<string, HTMLButtonElement>());
  const selection = interaction.selection ? objects.get(interaction.selection) : null;
  const hovered = interaction.hover ? objects.get(interaction.hover.key) : null;
  const menu = interaction.menu;
  const menuObject = menu ? objects.get(menu.key) : null;
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

  const detailsLabel = t('graphical.objects.viewDetails');
  const selectedRect = selection?.rect ? screenRect(selection.rect, viewport) : null;
  const narrow = stageWidth < 650 || interaction.device === 'touch';
  const cropDateDiffers = cropPreview && (cropPreview.reference.kind === 'season'
    || cropPreview.reference.date !== formatDateToAPI(new Date()));
  const previewWidth = Math.min(320, Math.max(124, stageWidth - 120));
  const cx = selectedRect ? selectedRect.x + selectedRect.width / 2 : 12;
  const below = selectedRect ? selectedRect.y + selectedRect.height + 8 : 50;
  const previewLeft = narrow ? 8 : Math.max(8, Math.min(stageWidth - previewWidth - 110, cx - previewWidth / 2));
  const rightOfObject = selectedRect ? selectedRect.x + selectedRect.width + 8 : 12;
  const beside = !narrow && selectedRect && rightOfObject + previewWidth + 105 < stageWidth;
  const pointer = interaction.hover?.point;
  const canvas = pointer && hovered ? root.current?.getBoundingClientRect() : undefined;

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
            aria-label={`${t(`hierarchy:details.entityType.${object.type}`)} · ${object.name}`}
            aria-haspopup="menu" aria-keyshortcuts="Shift+F10 ContextMenu" aria-pressed={active}
            onFocus={() => {
              if (!menuObject && rect && (rect.x + rect.width < 0 || rect.y + rect.height < 0
                || rect.x > stageWidth || rect.y > stageHeight) && object.rect) onFocusObject(object.rect);
            }}
            onClick={event => {
              if (event.detail !== 0 && visibleLabel) return;
              keyboardPreview.current = event.currentTarget;
              if (selectedKey === object.key) preview.current?.focus({ preventScroll: true });
              interaction.select(object.key);
            }}
            onKeyDown={event => keyboardMenu(event, object.key)}
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
          left: Math.max(8, Math.min(stageWidth - 180, pointer.x - canvas.left + 12)),
          ...(pointer.y - canvas.top < stageHeight - 100
            ? { top: Math.max(4, pointer.y - canvas.top + 14) }
            : { bottom: Math.max(4, canvas.bottom - pointer.y + 8) }),
          maxWidth: Math.min(220, stageWidth - 16),
        }}>
          <Stack><Typography variant="body2" sx={{ fontWeight: 700 }}>{hovered.name}</Typography>
            <ObjectFacts object={hovered} compact /></Stack>
        </Paper>
      )}
      {selection && (
        <Paper ref={preview} tabIndex={-1} role="region" aria-labelledby={titleId} data-testid="graphical-object-preview"
          elevation={6} sx={{
            position: 'absolute', zIndex: 3, width: previewWidth, left: beside ? rightOfObject : previewLeft, p: 1.5,
            maxHeight: 'min(55%, 360px)', overflowY: 'auto', touchAction: 'pan-y', overscrollBehavior: 'contain',
            ...(narrow ? { bottom: 8 } : beside ? { top: Math.max(48, Math.min(stageHeight - 132, selectedRect.y)) }
              : below < stageHeight / 2 ? { top: Math.max(48, below) }
                : { bottom: Math.max(8, Math.min(stageHeight * 0.45, stageHeight - (selectedRect?.y ?? stageHeight) + 8)) }),
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
            <ObjectFacts object={selection} />
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
            <Button size="small" onClick={() => openDetails(selection)}
              sx={{ alignSelf: 'flex-start', minHeight: 44 }}>{detailsLabel}</Button>
          </Stack>
        </Paper>
      )}
      <CustomContextMenu open={Boolean(menuObject)} mouseX={menu?.point.x} mouseY={menu?.point.y}
        keyboardNavigation onClose={closeMenu} container={getGraphicalPortalContainer()} disableRestoreFocus
        listLabel={menuObject?.name}>
        <MenuItem onClick={() => { if (menuObject) openDetails(menuObject); }}>{detailsLabel}</MenuItem>
      </CustomContextMenu>
    </>
  );
}

export function GraphicalObjectHint({ device, onClose, hasWarning }: {
  device: 'touch' | 'desktop';
  onClose: () => void;
  hasWarning: boolean;
}) {
  const { t } = useTranslation('fields');
  return <ContextMenuHint compact variant={device} ignorePointerAndViewport
    message={t(device === 'touch' ? 'graphical.objects.touchHint' : 'graphical.objects.desktopHint')}
    onClose={onClose} sx={{
      position: 'absolute', zIndex: 2, bottom: hasWarning ? 60 : 12, left: 12,
      maxWidth: 'min(680px, calc(100% - 112px))',
    }} />;
}
