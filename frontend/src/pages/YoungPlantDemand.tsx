import { Fragment, useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type TouchEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import {
  Alert,
  Box,
  CircularProgress,
  Collapse,
  IconButton,
  InputAdornment,
  Link,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { youngPlantDemandAPI } from '../api/api';
import type { YoungPlantDemand } from '../api/types';
import { useTranslation } from '../i18n';
import { AppTooltip } from '../components/AppTooltip';
import { ContextMenuActionItem } from '../components/contextMenu/ContextMenuActionItem';
import { ContextMenuIndicator } from '../components/contextMenu/ContextMenuIndicator';
import { contextMenuActionsCellSx, contextMenuActionsCellTextSx, contextMenuActionsOverlaySx } from '../components/contextMenu/contextMenuIndicatorStyles';
import { CustomContextMenu } from '../components/contextMenu/CustomContextMenu';
import { useRowContextMenuState } from '../components/contextMenu/useRowContextMenuState';
import { ROW_LONG_PRESS_MS, useLongPressTimer } from '../components/contextMenu/useLongPressTimer';
import { useCommandContextTag } from '../commands/useCommandContext';
import PageContainer from '../components/layout/PageContainer';
import PageSurface from '../components/layout/PageSurface';
import TableSurface from '../components/layout/TableSurface';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import EmptyStateCard from '../components/project/EmptyStateCard';
import { ContextMenuHint, TableCopyMenuItems, useContextMenuHint } from '../components/data-grid';
import { LocalizedDecimalField } from '../components/inputs/LocalizedDecimalField';
import { compactFieldSx, formRowSx } from '../components/forms/formLayout';
import { closestContextMenuElement, shouldOpenCustomContextMenu, suppressNativeContextMenu } from '../utils/contextMenu';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../utils/numberLocalization';
import {
  formatPlanLocation,
  formatPlantCount,
  formatPlantingDate,
  formatPlantingWeekLabel,
  formatPlantingWeekRange,
  getPlantCountUnavailableText,
  getReserveBreakdown,
  getYoungPlantCropLabel,
} from './youngPlantDemandFormat';

import { clampReservePercent, readStoredReservePercent, storeReservePercent } from './youngPlantDemandReserve';

// Stable identity so the memos downstream do not see a new array on every
// render while no project is selected.
const EMPTY_ROWS: YoungPlantDemand[] = [];
const RELOAD_DEBOUNCE_MS = 300;

export default function YoungPlantDemandPage() {
  useCommandContextTag('youngPlantDemand');
  const { t, i18n } = useTranslation(['crops', 'common']);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const navigate = useNavigate();
  const { shouldShowProjectRequiredState, missingProjectReason, activeProjectId } = useProjectRequirement();
  const [loadedRows, setRows] = useState<YoungPlantDemand[]>([]);
  const [isFetching, setIsLoading] = useState(true);
  const [fetchError, setError] = useState<string | null>(null);
  const [reservePercent, setReservePercent] = useState<number>(() => readStoredReservePercent(activeProjectId));
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());

  const rows = shouldShowProjectRequiredState ? EMPTY_ROWS : loadedRows;
  const isLoading = shouldShowProjectRequiredState ? false : isFetching;
  const error = shouldShowProjectRequiredState ? null : fetchError;
  const {
    showContextMenuHint,
    closeContextMenuHint,
    markContextMenuHintUsed,
    showTouchContextMenuHint,
    closeTouchContextMenuHint,
    markTouchContextMenuHintUsed,
  } = useContextMenuHint({
    contextKey: 'youngPlantDemand',
    enabled: !shouldShowProjectRequiredState,
    isLoading,
    hasRows: rows.length > 0,
  });
  const rowLongPressTimer = useLongPressTimer(ROW_LONG_PRESS_MS);

  useEffect(() => {
    if (shouldShowProjectRequiredState) {
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setIsLoading(true);
        setError(null);
        try {
          const response = await youngPlantDemandAPI.list(reservePercent);
          if (!cancelled) {
            setRows(response.data.results ?? []);
          }
        } catch {
          if (!cancelled) {
            setError(t('youngPlantDemand.loadError'));
          }
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
      })();
    }, RELOAD_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reservePercent, shouldShowProjectRequiredState, t]);

  const handleReserveChange = useCallback((value: number | null): void => {
    const next = clampReservePercent(value);
    setReservePercent(next);
    storeReservePercent(activeProjectId, next);
  }, [activeProjectId]);

  const toggleExpanded = useCallback((key: string): void => {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const getPlantCountLabel = useCallback((row: YoungPlantDemand): string => (
    formatPlantCount(row, locale) ?? getPlantCountUnavailableText(row, t)
  ), [locale, t]);

  const getPlansSummary = useCallback((row: YoungPlantDemand): string => (
    t('youngPlantDemand.plansSummary', { plans: row.plan_count, beds: row.bed_count })
  ), [t]);

  const getRowClipboardValues = useCallback((row: YoungPlantDemand): string[] => [
    getYoungPlantCropLabel(row),
    row.variety,
    [formatPlantingWeekLabel(row.planting_week, t), formatPlantingWeekRange(row.planting_week, locale, t)]
      .filter((part) => part.length > 0)
      .join(' '),
    getPlantCountLabel(row),
    getPlansSummary(row),
  ], [getPlansSummary, getPlantCountLabel, locale, t]);

  const getTableClipboardRows = useCallback((): string[][] => [
    [
      t('youngPlantDemand.columns.crop'),
      t('youngPlantDemand.columns.variety'),
      t('youngPlantDemand.columns.plantingWeek'),
      t('youngPlantDemand.columns.plantCount'),
      t('youngPlantDemand.columns.plans'),
    ],
    ...rows.map(getRowClipboardValues),
  ], [getRowClipboardValues, rows, t]);

  const isContextMenuTarget = useCallback((target: EventTarget | null): boolean => (
    shouldOpenCustomContextMenu(target) &&
    closestContextMenuElement(target, 'tr[data-young-plant-demand-key]') !== null
  ), []);
  const {
    state: contextMenuState,
    listRef: contextMenuListRef,
    open: openContextMenuState,
    close: closeContextMenu,
  } = useRowContextMenuState<YoungPlantDemand>({ isContextMenuTarget });

  const openContextMenu = useCallback((event: MouseEvent<HTMLTableRowElement>, row: YoungPlantDemand): void => {
    if (!isContextMenuTarget(event.target)) {
      return;
    }
    suppressNativeContextMenu(event);
    markContextMenuHintUsed();
    openContextMenuState(row, event.clientX + 2, event.clientY - 6, event.currentTarget);
  }, [isContextMenuTarget, markContextMenuHintUsed, openContextMenuState]);

  const handleRowTouchStart = useCallback((event: TouchEvent<HTMLTableRowElement>, row: YoungPlantDemand): void => {
    if (event.touches.length !== 1 || !isContextMenuTarget(event.target)) {
      return;
    }
    const touch = event.touches[0];
    const originElement = event.currentTarget;
    rowLongPressTimer.start(() => {
      markTouchContextMenuHintUsed();
      openContextMenuState(row, touch.clientX + 2, touch.clientY - 6, originElement);
    });
  }, [isContextMenuTarget, markTouchContextMenuHintUsed, openContextMenuState, rowLongPressTimer]);

  const handleRowTouchMove = useCallback((): void => {
    rowLongPressTimer.clear();
  }, [rowLongPressTimer]);

  const handleRowTouchEnd = useCallback((event: TouchEvent<HTMLTableRowElement>): void => {
    rowLongPressTimer.endTouch(event);
  }, [rowLongPressTimer]);

  const openKeyboardContextMenu = useCallback((event: KeyboardEvent<HTMLTableRowElement>, row: YoungPlantDemand): void => {
    const shouldOpenContextMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!shouldOpenContextMenu) {
      return;
    }
    suppressNativeContextMenu(event);
    markContextMenuHintUsed();
    const rowRect = event.currentTarget.getBoundingClientRect();
    openContextMenuState(row, rowRect.left + Math.min(240, rowRect.width), rowRect.top + 12, event.currentTarget);
  }, [markContextMenuHintUsed, openContextMenuState]);

  const openInlineActionMenu = useCallback((event: MouseEvent<HTMLButtonElement>, row: YoungPlantDemand): void => {
    event.preventDefault();
    event.stopPropagation();
    markContextMenuHintUsed();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenuState(row, rect.right - 8, rect.top + 12, event.currentTarget);
  }, [markContextMenuHintUsed, openContextMenuState]);

  const runContextMenuNavigation = useCallback((buildPath: (row: YoungPlantDemand) => string): void => {
    if (!contextMenuState) {
      return;
    }
    const { key: row } = contextMenuState;
    closeContextMenu();
    navigate(buildPath(row));
  }, [closeContextMenu, contextMenuState, navigate]);

  const emptyState = useMemo(() => (
    <EmptyStateCard
      title={t('youngPlantDemand.emptyState.title')}
      description={t('youngPlantDemand.emptyState.description')}
      actions={[{ label: t('youngPlantDemand.emptyState.action'), to: '/app/planting-plans' }]}
    />
  ), [t]);

  if (shouldShowProjectRequiredState && missingProjectReason) {
    return (
      <PageContainer variant="standardCenteredPage">
        <PageSurface variant="contentFit">
          <ProjectRequiredState reason={missingProjectReason} />
        </PageSurface>
      </PageContainer>
    );
  }

  const renderPlantCountValue = (row: YoungPlantDemand) => {
    const formatted = formatPlantCount(row, locale);
    if (formatted === null) {
      // On phones the icon stands alone here; the hint text sits under the crop name.
      return (
        <Typography
          variant="body2"
          color="warning.main"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, textAlign: 'left' }}
        >
          <WarningAmberOutlinedIcon fontSize="inherit" />
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            {getPlantCountUnavailableText(row, t)}
          </Box>
        </Typography>
      );
    }
    const breakdown = getReserveBreakdown(row, locale, t);
    const value = <Typography variant="body2" component="span">{formatted}</Typography>;
    return breakdown ? <AppTooltip title={breakdown}>{value}</AppTooltip> : value;
  };

  const renderPlans = (row: YoungPlantDemand) => (
    <Table size="small" aria-label={t('youngPlantDemand.columns.plans')}>
      <TableHead>
        <TableRow>
          <TableCell>{t('youngPlantDemand.detailColumns.area')}</TableCell>
          <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
            {t('youngPlantDemand.detailColumns.plantingDate')}
          </TableCell>
          <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
            {t('youngPlantDemand.detailColumns.areaM2')}
          </TableCell>
          <TableCell align="right">{t('youngPlantDemand.detailColumns.plantCount')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {row.plans.map((plan) => (
          <TableRow key={plan.plan_id}>
            <TableCell>
              {formatPlanLocation(plan)}
              <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'block', sm: 'none' } }}>
                {formatPlantingDate(plan.planting_date, locale)}
              </Typography>
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap', display: { xs: 'none', sm: 'table-cell' } }}>
              {formatPlantingDate(plan.planting_date, locale)}
            </TableCell>
            <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
              {plan.area_usage_sqm === null ? '—' : formatLocalizedNumber(plan.area_usage_sqm, locale)}
            </TableCell>
            <TableCell align="right">
              {plan.plant_count === null ? (
                <Typography variant="body2" color="warning.main">{getPlantCountUnavailableText(plan, t)}</Typography>
              ) : formatLocalizedNumber(plan.plant_count, locale)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <PageContainer variant="standardCenteredPage">
      <PageSurface variant="contentFit">
        {!shouldShowProjectRequiredState ? (
          <Box sx={{ ...formRowSx, alignItems: 'center', mb: 1.5 }}>
            <LocalizedDecimalField
              label={t('youngPlantDemand.reserveLabel')}
              value={reservePercent}
              onValueChange={handleReserveChange}
              size="small"
              sx={compactFieldSx}
              slotProps={{
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                htmlInput: { 'aria-describedby': 'young-plant-reserve-helper' },
              }}
            />
            <Typography id="young-plant-reserve-helper" variant="caption" color="text.secondary" sx={{ maxWidth: 360 }}>
              {t('youngPlantDemand.reserveHelper')}
            </Typography>
          </Box>
        ) : null}

        {isLoading && rows.length === 0 && <CircularProgress />}
        {error && <Alert severity="error">{error}</Alert>}

        {!error && !isLoading && rows.length === 0 ? emptyState : null}

        {!error && rows.length > 0 && showContextMenuHint ? (
          <ContextMenuHint
            variant="desktop"
            message={t('common:messages.contextMenuTableHint')}
            onClose={closeContextMenuHint}
            sx={{ mb: 1.25 }}
          />
        ) : null}

        {!error && rows.length > 0 && showTouchContextMenuHint ? (
          <ContextMenuHint
            variant="touch"
            message={t('common:messages.contextMenuTableHintTouch')}
            onClose={closeTouchContextMenuHint}
            sx={{ mb: 1.25 }}
          />
        ) : null}

        {!error && rows.length > 0 && (
          <TableSurface sizingMode="contentFit">
            <TableContainer>
              <Table sx={{ '& .MuiTableCell-root': { py: 1 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>{t('youngPlantDemand.columns.crop')}</TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      {t('youngPlantDemand.columns.variety')}
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      {t('youngPlantDemand.columns.plantingWeek')}
                    </TableCell>
                    <TableCell align="right">{t('youngPlantDemand.columns.plantCount')}</TableCell>
                    <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      {t('youngPlantDemand.columns.plans')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const isExpanded = expandedKeys.has(row.key);
                    const weekRange = formatPlantingWeekRange(row.planting_week, locale, t);
                    return (
                      <Fragment key={row.key}>
                        <TableRow
                          data-young-plant-demand-key={row.key}
                          hover
                          tabIndex={0}
                          onContextMenu={(event) => openContextMenu(event, row)}
                          onKeyDown={(event) => openKeyboardContextMenu(event, row)}
                          onTouchStart={(event) => handleRowTouchStart(event, row)}
                          onTouchMove={handleRowTouchMove}
                          onTouchEnd={handleRowTouchEnd}
                          onTouchCancel={handleRowTouchMove}
                          sx={{ WebkitTouchCallout: 'none', '& > .MuiTableCell-root': { borderBottom: isExpanded ? 'none' : undefined } }}
                        >
                          <TableCell padding="checkbox">
                            <IconButton
                              size="small"
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? t('youngPlantDemand.hidePlans') : t('youngPlantDemand.showPlans')}
                              onClick={() => toggleExpanded(row.key)}
                            >
                              {isExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                            </IconButton>
                          </TableCell>
                          <TableCell sx={{ minWidth: { xs: 0, sm: 160 }, maxWidth: { xs: 'none', sm: 240 } }}>
                            <Box sx={contextMenuActionsCellSx}>
                              <Box sx={contextMenuActionsCellTextSx}>
                                <Link component={RouterLink} to={`/app/crops?cropId=${row.crop_id}`} underline="hover">
                                  {getYoungPlantCropLabel(row)}
                                </Link>
                              </Box>
                              <Box sx={contextMenuActionsOverlaySx('tr:hover &', 'tr:focus-within &')}>
                                <ContextMenuIndicator
                                  label={t('common:actions.actions')}
                                  onClick={(event) => openInlineActionMenu(event, row)}
                                />
                              </Box>
                            </Box>
                            <Box sx={{ display: { xs: 'block', sm: 'none' } }}>
                              {row.variety ? (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  {row.variety}
                                </Typography>
                              ) : null}
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {[formatPlantingWeekLabel(row.planting_week, t), weekRange].filter(Boolean).join(' · ')}
                              </Typography>
                              {row.plant_count_with_reserve === null ? (
                                <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                                  {getPlantCountUnavailableText(row, t)}
                                </Typography>
                              ) : null}
                            </Box>
                          </TableCell>
                          <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{row.variety || '—'}</TableCell>
                          <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            <Typography variant="body2">{formatPlantingWeekLabel(row.planting_week, t)}</Typography>
                            {weekRange ? (
                              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                                {weekRange}
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell align="right" sx={{ maxWidth: 220 }}>
                            {renderPlantCountValue(row)}
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: { xs: 'block', sm: 'none' }, whiteSpace: 'nowrap' }}
                            >
                              {getPlansSummary(row)}
                            </Typography>
                          </TableCell>
                          <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            <AppTooltip title={t('youngPlantDemand.plansSummaryTooltip', { count: row.plan_count, beds: row.bed_count })}>
                              <Typography variant="body2" component="span">{getPlansSummary(row)}</Typography>
                            </AppTooltip>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={6} sx={{ py: 0, ...(isExpanded ? {} : { borderBottom: 'none' }) }}>
                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                              <Box sx={{ py: 1, pl: { xs: 0, sm: 6 } }}>{renderPlans(row)}</Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </TableSurface>
        )}
      </PageSurface>

      <CustomContextMenu
        open={contextMenuState !== null}
        onClose={closeContextMenu}
        keyboardNavigation
        listRef={contextMenuListRef}
        mouseX={contextMenuState?.mouseX}
        mouseY={contextMenuState?.mouseY}
      >
        <ContextMenuActionItem
          label={t('youngPlantDemand.contextMenu.openCrop')}
          icon={<OpenInNewIcon fontSize="small" />}
          onClick={() => runContextMenuNavigation((row) => `/app/crops?cropId=${row.crop_id}`)}
        />
        <ContextMenuActionItem
          label={t('youngPlantDemand.contextMenu.editCrop')}
          icon={<EditIcon fontSize="small" />}
          onClick={() => runContextMenuNavigation((row) => `/app/crops?cropId=${row.crop_id}&action=edit`)}
        />
        <TableCopyMenuItems
          rowValues={contextMenuState ? getRowClipboardValues(contextMenuState.key) : null}
          tableRows={getTableClipboardRows()}
          includeDivider
          onClose={closeContextMenu}
        />
      </CustomContextMenu>
    </PageContainer>
  );
}
