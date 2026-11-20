import { loadRetryAlertSx } from '../components/loadRetryStyles';
import LoadRetryButton from "../components/LoadRetryButton";
import { useEffect, useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import { Link as RouterLink, useOutletContext } from "react-router";
import {
  Alert,
  Box,
  Link,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import {
  plantingPlanAPI,
  yieldCalendarAPI,
  type PlantingPlan,
} from "../api/api";
import type { YieldCalendarForecast } from "../api/types";
import PageContainer from "../components/layout/PageContainer";
import PageSurface from "../components/layout/PageSurface";
import EmptyStateCard from "../components/project/EmptyStateCard";
import ProjectRequiredState from "../components/project/ProjectRequiredState";
import { useProjectRequirement } from "../hooks/useProjectRequirement";
import { useTranslation } from "../i18n";
import type { RootLayoutOutletContext } from "../navigation/topbarTypes";
import { plantingPlanDetailPath } from "../planting-plans/plantingPlanDetailRoutes";
import { YieldFilterBar } from "./YieldFilterBar";
import { YieldDistributionChart } from "./YieldDistributionChart";
import {
  ALL_CROPS,
  type ChartPeriod,
  type YieldCropMeta,
} from "./yieldOverviewUtils";
import { formatCropDisplayName, getCropDisplayName } from "../crops/cropDisplay";
import { segmentedToggleButtonGroupSx, segmentedToggleButtonSx } from "../components/buttons/segmentedControlStyles";
import { YieldSeasonComparison } from "./YieldSeasonComparison";

const EMPTY_FORECAST: YieldCalendarForecast = { weeks: [], incomplete_plans: [] };
type YieldView = 'calendar' | 'comparison';

export default function YieldOverviewPage() {
  const { t, i18n } = useTranslation("yieldOverview");
  const { activeProjectId, shouldShowProjectRequiredState, missingProjectReason } =
    useProjectRequirement();
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const activeSeason = outletContext?.activeSeason ?? null;
  const scope = `${activeProjectId ?? ''}:${activeSeason?.id ?? ''}`;
  const [view, setView] = useState<YieldView>('calendar');
  const [selectedCropId, setSelectedCropId] = useState(ALL_CROPS);
  const [period, setPeriod] = useState<ChartPeriod>("week");
  const [isFetching, setLoading] = useState(true);
  const [fetchError, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [plantingPlans, setPlantingPlans] = useState<PlantingPlan[]>([]);
  const [forecast, setForecast] = useState(EMPTY_FORECAST);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const { weeks: weeklyYield, incomplete_plans: incompletePlans } = forecast;

  // Without a project there is nothing to fetch, so the page is neither
  // loading nor in error. Derived rather than pushed into state from the
  // effect below — the fetched collections do not need clearing either,
  // because the project-required branch renders before they are read and
  // `loading` is back to true by the time a project appears.
  const loading = !shouldShowProjectRequiredState && (isFetching || scope !== loadedScope);
  const error = shouldShowProjectRequiredState ? null : fetchError;

  useEffect(() => {
    if (shouldShowProjectRequiredState) {
      return;
    }

    // React 18 StrictMode intentionally double-invokes this effect in dev,
    // firing the request twice; without this guard the slower/stale response
    // can resolve after the newer one and silently overwrite it with old data.
    let ignore = false;

    const fetchData = async (): Promise<void> => {
      try {
        setLoading(true);
        setError(null);
        const [plansRes, forecastRes] = await Promise.all([
          plantingPlanAPI.listAll(),
          yieldCalendarAPI.forecast(),
        ]);
        if (ignore) {
          return;
        }
        setPlantingPlans(plansRes.results);
        setForecast(forecastRes.data);
      } catch (err) {
        if (ignore) {
          return;
        }
        console.error("Error fetching yield overview data:", err);
        setError(t("errors.load"));
      } finally {
        if (!ignore) {
          setLoadedScope(scope);
          setLoading(false);
        }
      }
    };

    void fetchData();
    return () => {
      ignore = true;
    };
  }, [scope, shouldShowProjectRequiredState, t, retryAttempt]);

  const crops = useMemo(() => {
    const cropMap = new Map<number, YieldCropMeta>();
    weeklyYield.forEach((week) => {
      week.crops.forEach((crop) => {
        cropMap.set(crop.crop_id, {
          id: crop.crop_id,
          name: getCropDisplayName(crop),
          color: crop.color,
        });
      });
    });
    return [...cropMap.values()].sort((left, right) =>
      left.name.localeCompare(
        right.name,
        i18n.resolvedLanguage ?? i18n.language,
      ),
    );
  }, [i18n.language, i18n.resolvedLanguage, weeklyYield]);

  const calendarCropId = crops.some(crop => String(crop.id) === selectedCropId)
    ? selectedCropId : ALL_CROPS;

  if (shouldShowProjectRequiredState && missingProjectReason) {
    return (
      <PageContainer variant="workspacePage">
        <PageSurface variant="fullWorkspace">
          <ProjectRequiredState reason={missingProjectReason} />
        </PageSurface>
      </PageContainer>
    );
  }

  const hasYieldData = weeklyYield.length > 0;
  const hasRelevantPlans = plantingPlans.length > 0 || hasYieldData || incompletePlans.length > 0;
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });

  const calendar = loading ? (
    <Typography variant="body1" role="status">{t("loading")}</Typography>
  ) : error ? (
    <Alert severity="error" sx={loadRetryAlertSx}
      action={<LoadRetryButton onClick={() => setRetryAttempt(attempt => attempt + 1)} />}>
      {error}
    </Alert>
  ) : (
    <>
      <YieldFilterBar
        crops={crops}
        selectedCropId={calendarCropId}
        period={period}
        onCropChange={setSelectedCropId}
        onPeriodChange={setPeriod}
      />

      {incompletePlans.length > 0 && (
        <Alert severity="warning" sx={{ '& .MuiAlert-message': { minWidth: 0 }, overflowWrap: 'anywhere' }}>
          <details>
            <Box component="summary" sx={{ cursor: 'pointer', minHeight: 44, alignContent: 'center' }}>
              {t('diagnostics.title', { count: incompletePlans.length })}
            </Box>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {incompletePlans.map(plan => {
                const date = plan.planting_date
                  ? dateFormatter.format(new Date(`${plan.planting_date}T00:00:00Z`))
                  : null;
                const planLabel = [
                  formatCropDisplayName(plan) || t('diagnostics.unnamedPlan'),
                  plan.bed_name,
                  date,
                ].filter(Boolean).join(' · ');
                return (
                  <Box component="li" key={plan.plan_id} sx={{ mb: 0.75 }}>
                    <Link component={RouterLink} to={plantingPlanDetailPath(plan.plan_id)}>
                      {planLabel}
                    </Link>
                    <Typography variant="body2">
                      {plan.calculation_blockers.map(blocker => t(`diagnostics.blockers.${blocker}`)).join(' · ')}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </details>
        </Alert>
      )}

      {!hasRelevantPlans ? (
        <EmptyStateCard
          title={t("empty.noPlansTitle")}
          description={t("empty.description")}
          actions={[
            {
              label: t("empty.createPlanAction"),
              to: "/app/planting-plans?create=true",
              icon: <AddIcon fontSize="small" />,
            },
          ]}
          containerSx={{ maxWidth: "none", mb: 0 }}
        />
      ) : hasYieldData ? (
        <YieldDistributionChart
          weeklyYield={weeklyYield}
          selectedCropId={calendarCropId}
          period={period}
          activeSeason={activeSeason}
        />
      ) : (
        <EmptyStateCard
          title={t("empty.noYieldTitle")}
          description={t("empty.noYieldDescription")}
          actions={[
            { label: t("empty.openPlansAction"), to: "/app/planting-plans" },
          ]}
          containerSx={{ maxWidth: "none", mb: 0 }}
        />
      )}
    </>
  );

  return (
    <PageContainer variant="workspacePage">
      <PageSurface variant="fullWorkspace">
        <Stack spacing={2}>
          <ToggleButtonGroup value={view} exclusive aria-label={t('comparison.view')}
            size="small" color="primary" sx={{ ...segmentedToggleButtonGroupSx, alignSelf: 'flex-start' }}
            onChange={(_, next: YieldView | null) => { if (next !== null) setView(next); }}>
            <ToggleButton value="calendar" sx={{ ...segmentedToggleButtonSx, minHeight: 44 }}>{t('comparison.calendar')}</ToggleButton>
            <ToggleButton value="comparison" sx={{ ...segmentedToggleButtonSx, minHeight: 44 }}>{t('comparison.seasons')}</ToggleButton>
          </ToggleButtonGroup>

          {view === 'comparison' ? (
            <YieldSeasonComparison key={activeProjectId} cropId={selectedCropId} onCropChange={setSelectedCropId} />
          ) : calendar}
        </Stack>
      </PageSurface>
    </PageContainer>
  );
}
