import { useEffect, useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import { useOutletContext } from "react-router";
import {
  Alert,
  Stack,
  Typography,
} from "@mui/material";
import {
  plantingPlanAPI,
  yieldCalendarAPI,
  type PlantingPlan,
  type YieldCalendarWeek,
} from "../api/api";
import PageContainer from "../components/layout/PageContainer";
import PageSurface from "../components/layout/PageSurface";
import EmptyStateCard from "../components/project/EmptyStateCard";
import ProjectRequiredState from "../components/project/ProjectRequiredState";
import { useProjectRequirement } from "../hooks/useProjectRequirement";
import { useTranslation } from "../i18n";
import type { RootLayoutOutletContext } from "../navigation/topbarTypes";
import { YieldFilterBar } from "./YieldFilterBar";
import { YieldDistributionChart } from "./YieldDistributionChart";
import {
  ALL_CROPS,
  type ChartPeriod,
  type YieldCropMeta,
} from "./yieldOverviewUtils";
import { getCropDisplayName } from "../crops/cropDisplay";

export default function YieldOverviewPage() {
  const { t, i18n } = useTranslation("yieldOverview");
  const { shouldShowProjectRequiredState, missingProjectReason } =
    useProjectRequirement();
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const activeSeason = outletContext?.activeSeason ?? null;
  const [selectedCropId, setSelectedCropId] = useState(ALL_CROPS);
  const [period, setPeriod] = useState<ChartPeriod>("week");
  const [isFetching, setLoading] = useState(true);
  const [fetchError, setError] = useState<string | null>(null);
  const [plantingPlans, setPlantingPlans] = useState<PlantingPlan[]>([]);
  const [weeklyYield, setWeeklyYield] = useState<YieldCalendarWeek[]>([]);

  // Without a project there is nothing to fetch, so the page is neither
  // loading nor in error. Derived rather than pushed into state from the
  // effect below — the fetched collections do not need clearing either,
  // because the project-required branch renders before they are read and
  // `loading` is back to true by the time a project appears.
  const loading = shouldShowProjectRequiredState ? false : isFetching;
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
        const [plansRes, weeklyYieldRes] = await Promise.all([
          plantingPlanAPI.listAll(),
          yieldCalendarAPI.list(),
        ]);
        if (ignore) {
          return;
        }
        setPlantingPlans(plansRes.results);
        setWeeklyYield(weeklyYieldRes.data);
      } catch (err) {
        if (ignore) {
          return;
        }
        console.error("Error fetching yield overview data:", err);
        setError(t("errors.load"));
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    void fetchData();
    return () => {
      ignore = true;
    };
  }, [shouldShowProjectRequiredState, t]);

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

  useEffect(() => {
    if (
      selectedCropId !== ALL_CROPS &&
      !crops.some(
        (crop) => String(crop.id) === selectedCropId,
      )
    ) {
      setSelectedCropId(ALL_CROPS);
    }
  }, [crops, selectedCropId]);

  if (loading) {
    return (
      <PageContainer variant="workspacePage">
        <PageSurface variant="fullWorkspace" sx={{ py: 2 }}>
          <Typography variant="body1">{t("loading")}</Typography>
        </PageSurface>
      </PageContainer>
    );
  }

  if (shouldShowProjectRequiredState && missingProjectReason) {
    return (
      <PageContainer variant="workspacePage">
        <PageSurface variant="fullWorkspace">
          <ProjectRequiredState reason={missingProjectReason} />
        </PageSurface>
      </PageContainer>
    );
  }

  const hasPlantingPlans = plantingPlans.length > 0;
  const hasYieldData = weeklyYield.length > 0;

  return (
    <PageContainer variant="workspacePage">
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <PageSurface variant="fullWorkspace">
        <Stack spacing={2}>
          <YieldFilterBar
            crops={crops}
            selectedCropId={selectedCropId}
            period={period}
            onCropChange={setSelectedCropId}
            onPeriodChange={setPeriod}
          />

          {!hasPlantingPlans ? (
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
              selectedCropId={selectedCropId}
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
        </Stack>
      </PageSurface>
    </PageContainer>
  );
}
