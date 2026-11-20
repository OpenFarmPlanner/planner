import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router';
import { CONTEXT_MENU_INDICATOR_CLASS } from '../components/contextMenu/contextMenuIndicatorStyles';
import PageContainer from '../components/layout/PageContainer';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import { useTranslation } from '../i18n';
import { plantingPlanDetailPath, plantingPlanIdFromPath, PLANTING_PLANS_PATH } from '../planting-plans/plantingPlanDetailRoutes';
import { PlantingPlanDetails } from '../planting-plans/PlantingPlanDetails';
import PlantingPlans from './PlantingPlans';
import type { PlantingPlanSearchSnapshot } from './usePlantingPlanSearch';

interface TableOrigin {
  plantingPlanTable: true;
  projectId: number | null;
  openedAsDrawer: boolean;
  view: PlantingPlanSearchSnapshot;
  expanded?: boolean;
}

export default function PlantingPlansRoute() {
  const { plantingPlanId } = useParams();
  const isDetails = plantingPlanId !== undefined;
  const planId = plantingPlanIdFromPath(plantingPlanId);
  const { activeProjectId } = useProjectRequirement();
  const { t } = useTranslation('plantingPlans');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();
  const navigate = useNavigate();
  const origin = location.state as TableOrigin | null;
  const fromTable = planId !== null && activeProjectId !== null
    && origin?.plantingPlanTable === true && origin.projectId === activeProjectId;
  // Keep the presentation for this visit so resizing or rotating the device
  // cannot unmount a notes editor with a draft or a pending photo.
  const drawer = fromTable && origin.openedAsDrawer && !origin.expanded;
  const tableRef = useRef<HTMLDivElement>(null);
  const invokingRow = useRef<{ planId: number; anchor: HTMLElement | null } | null>(
    fromTable && planId !== null ? { planId, anchor: null } : null,
  );
  const [revision, setRevision] = useState(0);

  const openDetails = useCallback((id: number, view: PlantingPlanSearchSnapshot, anchor?: HTMLElement | null) => {
    invokingRow.current = { planId: id, anchor: anchor ?? null };
    void navigate({ pathname: plantingPlanDetailPath(id, location.pathname), search: location.search }, {
      state: { plantingPlanTable: true, projectId: activeProjectId, openedAsDrawer: !isMobile, view } satisfies TableOrigin,
    });
  }, [activeProjectId, isMobile, location.pathname, location.search, navigate]);

  const returnToTable = () => {
    if (fromTable) void navigate(-1);
    else void navigate(PLANTING_PLANS_PATH, { replace: true });
  };

  useEffect(() => {
    if (isDetails || !invokingRow.current) return;
    const { anchor, planId: invokedPlan } = invokingRow.current;
    invokingRow.current = null;
    const frame = requestAnimationFrame(() => {
      const rowTrigger = tableRef.current?.querySelector<HTMLElement>(
        `[data-id="${invokedPlan}"] .${CONTEXT_MENU_INDICATOR_CLASS}`,
      );
      const target = anchor?.isConnected && anchor.getClientRects().length ? anchor : rowTrigger;
      (target ?? tableRef.current?.querySelector<HTMLElement>('[role="searchbox"]'))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isDetails]);

  const details = isDetails ? <PlantingPlanDetails key={`${activeProjectId}:${planId}`} planId={planId}
    onBack={returnToTable} onChanged={() => setRevision(value => value + 1)}
    onExpand={drawer && planId ? () => void navigate(location.pathname + location.search, {
      replace: true, state: { ...origin, expanded: true },
    }) : undefined} /> : null;

  return <>
    {(!isDetails || fromTable) && <Box ref={tableRef} hidden={isDetails && !drawer}>
      <PlantingPlans onOpenDetails={openDetails} detailOpen={isDetails} detailRevision={revision}
        restoredView={fromTable ? origin.view : undefined} />
    </Box>}
    {drawer ? <Drawer anchor="right" open onClose={returnToTable} slotProps={{ paper: {
      role: 'dialog', 'aria-modal': true, 'aria-label': t('details.title'),
      sx: { width: { xs: '100vw', md: 720 }, pt: 2, px: { xs: 2, md: 3 }, pb: 3, maxWidth: '100vw' },
    } }}>{details}</Drawer> : details && <PageContainer variant="standard" mobileInset>{details}</PageContainer>}
  </>;
}
