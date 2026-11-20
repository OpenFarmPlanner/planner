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

interface YieldFilterBarProps {
  crops: Pick<YieldCropMeta, 'id' | 'name'>[];
  selectedCropId: string;
  period?: ChartPeriod;
  allCropsLabel?: string;
  onCropChange: (cropId: string) => void;
  onPeriodChange?: (period: ChartPeriod) => void;
}

export function YieldFilterBar({
  crops,
  selectedCropId,
  period,
  allCropsLabel,
  onCropChange,
  onPeriodChange,
}: YieldFilterBarProps) {
  const { t } = useTranslation("yieldOverview");

  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1.5}
      sx={{ width: "100%", flexWrap: "wrap",
            alignItems: { xs: "stretch", sm: "flex-start" }, }}
    >
      <Stack spacing={0.5} sx={{ minWidth: { sm: 220 } }}>
        <Typography
          id="yield-crop-filter-label"
          variant="caption"
          color="text.secondary"
          sx={{ lineHeight: 1 }}
        >
          {t("filters.crop")}
        </Typography>
        <FormControl size="small" fullWidth>
          <Select
            fullWidth
            labelId="yield-crop-filter-label"
            value={selectedCropId}
            sx={allCropsLabel ? { minHeight: 44 } : undefined}
            onChange={(event) => onCropChange(String(event.target.value))}
          >
            <MenuItem value={ALL_CROPS}>{allCropsLabel ?? t("filters.allCrops")}</MenuItem>
            {crops.map((crop) => (
              <MenuItem key={crop.id} value={String(crop.id)}>
                {crop.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {period && onPeriodChange && <Stack spacing={0.5}>
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
          sx={{ ...segmentedToggleButtonGroupSx, height: 40 }}
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
      </Stack>}
    </Stack>
  );
}
