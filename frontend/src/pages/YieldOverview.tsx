import { loadRetryAlertSx } from '../components/loadRetryStyles';
import LoadRetryButton from "../components/LoadRetryButton";
import { useEffect, useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import { useOutletContext } from "react-router";
import { useTheme } from '@mui/material/styles';
import {
  Alert,
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
import { useTopbarWorkspaceControls } from "../hooks/useTopbarWorkspaceControls";
import { useProjectRequirement } from "../hooks/useProjectRequirement";
import { useTranslation } from "../i18n";
import type { RootLayoutOutletContext } from "../navigation/topbarTypes";
import { YieldFilterBar } from "./YieldFilterBar";
import { YieldForecastWarning } from "./YieldForecastWarning";
import { YieldDistributionChart } from "./YieldDistributionChart";
import {
  ALL_CROPS,
  type ChartPeriod,
} from "./yieldOverviewUtils";
import {
  buildForecastCropIndex,
  forecastCropMatches,
  projectForecastWeeks,
  type YieldForecastGrouping,
} from './yieldForecastGrouping';
import { segmentedToggleButtonGroupSx, segmentedToggleButtonSx } from "../components/buttons/segmentedControlStyles";
import { YieldSeasonComparison } from "./YieldSeasonComparison";
import { DEFAULT_YIELD_COMPARISON_FILTERS } from "./yieldComparisonFilters";
import appTheme from '../theme';

const EMPTY_FORECAST: YieldCalendarForecast = { weeks: [], incomplete_plans: [] };
type YieldView = 'calendar' | 'comparison';

export default function YieldOverviewPage() {
  const { t, i18n } = useTranslation("yieldOverview");
  const theme = useTheme();
  const varietySeries = theme.palette.chart?.varietySeries ?? appTheme.palette.chart.varietySeries;
  const seriesColors = varietySeries[theme.palette.mode];
  const { activeProjectId, shouldShowProjectRequiredState, missingProjectReason } =
    useProjectRequirement();
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const activeSeason = outletContext?.activeSeason ?? null;
  const scope = `${activeProjectId ?? ''}:${activeSeason?.id ?? ''}`;
  const [view, setView] = useState<YieldView>('calendar');
  const [grouping, setGrouping] = useState<YieldForecastGrouping>('crop');
  const [selectedCropId, setSelectedCropId] = useState(ALL_CROPS);
  const [selectedVarietyId, setSelectedVarietyId] = useState(ALL_CROPS);
  const [comparisonFilterState, setComparisonFilterState] = useState({
    projectId: activeProjectId, filters: DEFAULT_YIELD_COMPARISON_FILTERS,
  });
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

  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { crops, varieties, byId } = useMemo(() => buildForecastCropIndex(
    forecast, locale, (crop) => t('filters.generalVariety', { crop }), seriesColors,
  ), [forecast, locale, seriesColors, t]);
  const calendarCropId = crops.some(crop => String(crop.id) === selectedCropId)
    ? selectedCropId : ALL_CROPS;
  const cropVarieties = varieties.filter(variety =>
    calendarCropId === ALL_CROPS || String(variety.generalCrop.id) === calendarCropId,
  );
  const calendarVarietyId = cropVarieties.some(variety => String(variety.id) === selectedVarietyId)
    ? selectedVarietyId : ALL_CROPS;
  const forecastWeeks = useMemo(() => projectForecastWeeks(
    weeklyYield, byId, grouping, calendarCropId, calendarVarietyId,
  ), [weeklyYield, byId, grouping, calendarCropId, calendarVarietyId]);

  const viewControls = useMemo(() => shouldShowProjectRequiredState ? null : (
    <ToggleButtonGroup
      value={view}
      exclusive
      aria-label={t('comparison.view')}
      size="small"
      color="primary"
      sx={{ ...segmentedToggleButtonGroupSx, maxWidth: '100%' }}
      onChange={(_, next: YieldView | null) => {
        if (next !== null) setView(next);
      }}
    >
      <ToggleButton value="calendar" sx={{ ...segmentedToggleButtonSx, minHeight: 44, overflowWrap: 'anywhere' }}>
        {t('comparison.calendar')}
      </ToggleButton>
      <ToggleButton value="comparison" sx={{ ...segmentedToggleButtonSx, minHeight: 44, overflowWrap: 'anywhere' }}>
        {t('comparison.seasons')}
      </ToggleButton>
    </ToggleButtonGroup>
  ), [shouldShowProjectRequiredState, t, view]);
  useTopbarWorkspaceControls(outletContext?.setTopbarWorkspaceControls, viewControls);

  if (shouldShowProjectRequiredState && missingProjectReason) {
    return (
      <PageContainer variant="workspacePage">
        <PageSurface variant="fullWorkspace">
          <ProjectRequiredState reason={missingProjectReason} />
        </PageSurface>
      </PageContainer>
    );
  }

  const hasYieldData = forecastWeeks.some(week => week.crops.length > 0);
  const hasRelevantPlans = plantingPlans.length > 0 || weeklyYield.length > 0 || incompletePlans.length > 0;
  const visibleIncompletePlans = incompletePlans.filter(plan => {
    // Older responses omitted crop_id. Keep those warnings visible.
    if (plan.crop_id === undefined) return true;
    if (plan.crop_id === null) return calendarCropId === ALL_CROPS && calendarVarietyId === ALL_CROPS;
    return forecastCropMatches(plan.crop_id, byId, calendarCropId, calendarVarietyId);
  });

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
        varieties={cropVarieties}
        selectedVarietyId={calendarVarietyId}
        grouping={grouping}
        period={period}
        onCropChange={id => {
          setSelectedCropId(id);
          const keepsVariety = id === ALL_CROPS || varieties.some(variety =>
            String(variety.id) === calendarVarietyId && String(variety.generalCrop.id) === id);
          setSelectedVarietyId(keepsVariety ? calendarVarietyId : ALL_CROPS);
        }}
        onVarietyChange={setSelectedVarietyId}
        onGroupingChange={setGrouping}
        onPeriodChange={setPeriod}
      >
        {visibleIncompletePlans.length > 0 && (
          <YieldForecastWarning plans={visibleIncompletePlans} />
        )}
      </YieldFilterBar>

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
          weeklyYield={forecastWeeks}
          filterKey={`${grouping}:${calendarCropId}:${calendarVarietyId}`}
          showBreakdown={grouping === 'variety'}
          period={period}
          activeSeason={activeSeason}
        />
      ) : (
        <EmptyStateCard
          title={t(weeklyYield.length ? 'empty.noYieldForSelection' : 'empty.noYieldTitle')}
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
          {view === 'comparison' ? (
            <YieldSeasonComparison key={activeProjectId}
              filters={comparisonFilterState.projectId === activeProjectId
                ? comparisonFilterState.filters : DEFAULT_YIELD_COMPARISON_FILTERS}
              onFiltersChange={filters => setComparisonFilterState({ projectId: activeProjectId, filters })} />
          ) : calendar}
        </Stack>
      </PageSurface>
    </PageContainer>
  );
}
