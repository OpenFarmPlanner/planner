import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Box, Button, ClickAwayListener, Paper, Stack, Typography, useTheme } from '@mui/material';
import LegendToggleIcon from '@mui/icons-material/LegendToggle';
import { AppTooltip } from '../components/AppTooltip';
import { freeAreaColor } from '../components/hierarchy/utils/freeAreaColors';
import { BED_TASK_URGENCIES, bedTaskUrgencyLabel } from '../components/tasks/bedTaskUrgency';
import { useTranslation } from '../i18n';
import type { OutlineKind } from './graphicalAreaGeometry';
import { bedTaskColors, BED_TASK_SYMBOLS } from './graphicalBedTaskStyle';
import { includesCrops, includesTasks, type GraphicalDisplayMode } from './graphicalCultivation';
import { GRAPHICAL_GEOMETRY_OUTLINES, graphicalBedCropFill, graphicalGeometryOutline, graphicalPlantColors } from './graphicalDisplayStyle';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';

interface Props {
  mode: GraphicalDisplayMode;
  compact: boolean;
  hasBoundary: boolean;
  hasBeds: boolean;
  freeSite: boolean;
  freeParcel: boolean;
  geometryOutlines: ReadonlySet<OutlineKind>;
  hasStems: boolean;
  hasCanopies: boolean;
  canvasHint?: ReactNode;
  boundaryWarning?: ReactNode;
  scaleIndicator?: ReactNode;
}

function LegendItem({ marker, children }: { marker: ReactNode; children: ReactNode }) {
  return <Stack component="li" direction="row" spacing={1} sx={{ alignItems: 'center' }}>
    <Box aria-hidden sx={{ width: 24, flexShrink: 0, display: 'grid', placeItems: 'center' }}>{marker}</Box>
    <Typography variant="body2">{children}</Typography>
  </Stack>;
}

function FillSwatch({ color }: { color: string }) {
  return <Box sx={{ width: 20, height: 14, border: '1px solid', borderColor: 'divider', borderRadius: 0.5, bgcolor: color }} />;
}

const legendList = { p: 0, m: 0, listStyle: 'none' };

export function GraphicalDisplayLegend({
  mode, compact, hasBoundary, hasBeds, freeSite, freeParcel, geometryOutlines, hasStems, hasCanopies, canvasHint, boundaryWarning, scaleIndicator,
}: Props) {
  const { t } = useTranslation(['fields', 'dashboard', 'hierarchy', 'help']);
  const theme = useTheme();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const showCrops = includesCrops(mode);
  const showTasks = includesTasks(mode);
  const title = t('graphical.display.legend');
  const plantColors = graphicalPlantColors(theme);

  const close = () => {
    if (!open) return;
    if (panel.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  };

  useEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <ClickAwayListener mouseEvent="onMouseDown" touchEvent="onTouchStart" onClickAway={close}>
      <Box data-graphical-annotation-hints sx={{ position: 'absolute', inset: 8, zIndex: 3, pointerEvents: 'none' }}
        onKeyDown={event => {
          if (open && event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}>
        {!open && canvasHint}
        <Box sx={{ display: 'flex', gap: 1, position: 'absolute', insetInline: 0, bottom: 0, alignItems: 'end' }}>
          <Paper elevation={3} data-graphical-annotation-obstacle sx={{ borderRadius: 3, pointerEvents: 'auto', flexShrink: 0 }}>
            <AppTooltip title={compact && !open ? title : ''} placement="top" disableInteractive
              slotProps={{ popper: { container: getGraphicalPortalContainer } }}>
              <Button ref={trigger} aria-label={title} aria-haspopup="dialog" aria-expanded={open}
                aria-controls={open ? id : undefined} onClick={open ? close : () => setOpen(true)}
                sx={{ minWidth: 44, minHeight: 44, px: 1, gap: 0.5, borderRadius: 3, color: 'text.primary' }}>
                <LegendToggleIcon aria-hidden fontSize="small" />
                {!compact && <span>{title}</span>}
              </Button>
            </AppTooltip>
          </Paper>
          {boundaryWarning}
          {scaleIndicator}
        </Box>
        {open && <Paper ref={panel} id={id} role="dialog" aria-labelledby={`${id}-title`} tabIndex={-1} elevation={4} data-graphical-annotation-obstacle
          sx={{ position: 'absolute', left: 0, bottom: 52, width: 340, maxWidth: 'calc(100% - 56px)',
            maxHeight: 'calc(100% - 52px)', overflow: 'auto', overscrollBehavior: 'contain', touchAction: 'pan-y',
            pointerEvents: 'auto', borderRadius: 2, outline: 'none' }}>
          <Stack spacing={1.25} sx={{ p: 2, overflowWrap: 'anywhere' }}>
            <Typography id={`${id}-title`} component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
            <Typography variant="subtitle2">{t(`graphical.display.mode.${mode}`)}</Typography>
            {showCrops && <Stack spacing={0.5}>
              <Typography variant="body2">{t(showTasks ? 'graphical.display.combinedCropLegend' : 'graphical.display.cropLegend')}</Typography>
              {!showTasks && <Stack component="ul" spacing={0.5} sx={legendList}>
                <LegendItem marker={<FillSwatch color={graphicalBedCropFill(theme, 'growth')} />}>
                  {t('graphical.display.legendCropGrowth')}
                </LegendItem>
                <LegendItem marker={<FillSwatch color={graphicalBedCropFill(theme, 'harvest')} />}>
                  {t('graphical.display.phase.harvest')}
                </LegendItem>
                <LegendItem marker={<FillSwatch color={graphicalBedCropFill(theme, null)} />}>
                  {t('graphical.display.legendCropMixed')}
                </LegendItem>
              </Stack>}
            </Stack>}
            {showTasks && (
              <>
                <Stack component="ul" spacing={0.5} sx={legendList}>
                  {BED_TASK_URGENCIES.filter(urgency => urgency !== 'completed').map(urgency => {
                    const colors = bedTaskColors(theme, urgency);
                    return (
                      <LegendItem key={urgency} marker={
                        <Box sx={{ width: 21, bgcolor: colors.fill,
                          color: colors.glyph, textAlign: 'center', borderRadius: 0.5, fontWeight: 700 }}>
                          {BED_TASK_SYMBOLS[urgency]}
                        </Box>}>
                        {bedTaskUrgencyLabel(urgency, t)}
                      </LegendItem>
                    );
                  })}
                </Stack>
                <Typography variant="caption" color="text.secondary">{t('graphical.display.taskLegend')}
                  {hasStems && <> {t('graphical.display.legendStemTasks')}</>}
                </Typography>
              </>
            )}
            <Stack component="ul" spacing={0.5} sx={legendList}>
              {mode === 'areas' && <>
                {hasBoundary && <LegendItem marker={<Box sx={{ width: 20, height: 14, border: '1px dashed', borderColor: 'text.secondary' }} />}>
                  {t('graphical.display.legendBoundary')}
                </LegendItem>}
                <LegendItem marker={<FillSwatch color={theme.palette.grey[200]} />}>
                  {t('hierarchy:details.entityType.field')}
                </LegendItem>
                {hasBeds && <LegendItem marker={<FillSwatch color={theme.palette.info.light} />}>
                  {t('hierarchy:details.entityType.bed')}
                </LegendItem>}
              </>}
              {freeSite && <LegendItem marker={<FillSwatch color={freeAreaColor(theme, 'site')} />}>
                {t('hierarchy:details.coverage.outsideParcels')}
              </LegendItem>}
              {freeParcel && <LegendItem marker={<FillSwatch color={freeAreaColor(theme, 'parcel')} />}>
                {t('hierarchy:details.coverage.withoutBeds')}
              </LegendItem>}
              {GRAPHICAL_GEOMETRY_OUTLINES.filter(kind => geometryOutlines.has(kind)).map(kind => {
                const { stroke, strokeWidth, dash: [mark, gap] } = graphicalGeometryOutline(theme, kind);
                return <LegendItem key={kind} marker={<Box sx={{ width: 24, height: strokeWidth,
                  background: `repeating-linear-gradient(to right, ${stroke} 0 ${mark}px, transparent ${mark}px ${mark + gap}px)` }} />}>
                  {t(`graphical.display.legendGeometry.${kind}`)}
                </LegendItem>;
              })}
              {hasStems && <LegendItem marker={<Box sx={{ width: 18, height: 18, borderRadius: '50%',
                display: 'grid', placeItems: 'center', bgcolor: hasCanopies ? plantColors.canopyFill : undefined,
                border: hasCanopies ? `1px solid ${plantColors.canopyOutline}` : undefined }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: plantColors.stem }} />
              </Box>}>
                {t(hasCanopies ? 'help:pages.graphical.symbols.individualPlant' : 'graphical.display.legendStem')}
              </LegendItem>}
            </Stack>
          </Stack>
        </Paper>}
      </Box>
    </ClickAwayListener>
  );
}
