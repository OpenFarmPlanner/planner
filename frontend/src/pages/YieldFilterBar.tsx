import type { ReactNode } from "react";
import {
  FormControl,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import {
  segmentedToggleButtonGroupSx,
  segmentedToggleButtonSx,
} from "../components/buttons/segmentedControlStyles";
import { TypeaheadSelect as Select } from "../components/inputs/TypeaheadSelect";
import { useTranslation } from "../i18n";
import {
  ALL_CROPS,
  type ChartPeriod,
  type YieldCropMeta,
} from "./yieldOverviewUtils";
import type { YieldForecastGrouping } from './yieldForecastGrouping';

interface YieldFilterBarProps {
  crops: Pick<YieldCropMeta, 'id' | 'name'>[];
  selectedCropId: string;
  varieties: Pick<YieldCropMeta, 'id' | 'name'>[];
  selectedVarietyId: string;
  grouping: YieldForecastGrouping;
  period: ChartPeriod;
  onCropChange: (cropId: string) => void;
  onVarietyChange: (varietyId: string) => void;
  onGroupingChange: (grouping: YieldForecastGrouping) => void;
  onPeriodChange: (period: ChartPeriod) => void;
  children?: ReactNode;
}

function YieldSeriesFilter({ id, label, allLabel, options, value, onChange }: {
  id: string;
  label: string;
  allLabel: string;
  options: Pick<YieldCropMeta, 'id' | 'name'>[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Stack spacing={0.5} sx={{ width: { xs: '100%', sm: 'auto' }, minWidth: { sm: 220 }, maxWidth: '100%' }}>
      <Typography id={id} variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
        {label}
      </Typography>
      <FormControl size="small" fullWidth>
        <Select fullWidth labelId={id} value={value} sx={{ minHeight: 44 }}
          onChange={event => onChange(String(event.target.value))}>
          <MenuItem value={ALL_CROPS}>{allLabel}</MenuItem>
          {options.map(option => (
            <MenuItem key={option.id} value={String(option.id)} sx={{ whiteSpace: 'normal' }}>
              {option.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
}

export function YieldFilterBar({
  crops,
  selectedCropId,
  varieties,
  selectedVarietyId,
  grouping,
  period,
  onCropChange,
  onVarietyChange,
  onGroupingChange,
  onPeriodChange,
  children,
}: YieldFilterBarProps) {
  const { t } = useTranslation("yieldOverview");

  return (
    <Stack
      direction="row"
      spacing={1.5}
      useFlexGap
      sx={{ width: "100%", flexWrap: "wrap", alignItems: "flex-end" }}
    >
      <YieldSeriesFilter id="yield-crop-filter-label" label={t('filters.crop')}
        allLabel={t('filters.allCrops')} options={crops} value={selectedCropId} onChange={onCropChange} />
      <YieldSeriesFilter id="yield-variety-filter-label" label={t('filters.variety')}
        allLabel={t('filters.allVarieties')} options={varieties} value={selectedVarietyId}
        onChange={onVarietyChange} />
      <Stack spacing={0.5} sx={{ maxWidth: '100%' }}>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
          {t('filters.grouping')}
        </Typography>
        <ToggleButtonGroup value={grouping} exclusive size="small" color="primary"
          aria-label={t('filters.grouping')} sx={{ ...segmentedToggleButtonGroupSx, minHeight: 44 }}
          onChange={(_, value: YieldForecastGrouping | null) => { if (value) onGroupingChange(value); }}>
          <ToggleButton value="crop" sx={segmentedToggleButtonSx}>{t('filters.byCrop')}</ToggleButton>
          <ToggleButton value="variety" sx={segmentedToggleButtonSx}>{t('filters.byVariety')}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Stack spacing={0.5}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ lineHeight: 1 }}
        >
          {t("filters.period")}
        </Typography>
        <ToggleButtonGroup
          value={period}
          exclusive
          size="small"
          color="primary"
          aria-label={t("filters.period")}
          sx={{ ...segmentedToggleButtonGroupSx, minHeight: 44 }}
          onChange={(_, value: ChartPeriod | null) => {
            if (value !== null) {
              onPeriodChange(value);
            }
          }}
        >
          <ToggleButton value="week" sx={segmentedToggleButtonSx}>
            {t("filters.week")}
          </ToggleButton>
          <ToggleButton value="month" sx={segmentedToggleButtonSx}>
            {t("filters.month")}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {children}
    </Stack>
  );
}
