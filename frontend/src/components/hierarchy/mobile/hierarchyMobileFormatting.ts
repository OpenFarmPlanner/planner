import type { TFunction } from "i18next";
import { calculateAreaValue } from "../utils/dimensionCellState";
import { formatLocalizedNumber } from "../../../utils/numberLocalization";
import type { MobileHierarchyRow } from "../hooks/useMobileHierarchyRows";

/**
 * Builds the secondary (grey) line shown under a row's name in
 * `HierarchyMobileList.tsx`.
 */
export function buildHierarchySecondaryLine(
  row: MobileHierarchyRow,
  t: TFunction,
  locale: string,
): string {
  if (row.type === "location") {
    const count = row.childCount;
    if (count === 0) {
      return t("hierarchy:mobile.secondary.field_zero", { count });
    }
    if (count === 1) {
      return t("hierarchy:mobile.secondary.field_one", { count });
    }
    return t("hierarchy:mobile.secondary.field_other", { count });
  }

  const typeLabel = t(`hierarchy:mobile.typeLabel.${row.type}`);
  const hasLength = typeof row.length_m === "number" && Number.isFinite(row.length_m);
  const hasWidth = typeof row.width_m === "number" && Number.isFinite(row.width_m);

  if (!hasLength || !hasWidth) {
    return t("hierarchy:mobile.secondary.noDimensions", { type: typeLabel });
  }

  const area = calculateAreaValue(row);
  const numericArea = typeof area === "number" ? area : Number(area);

  return t("hierarchy:mobile.secondary.dimensions", {
    type: typeLabel,
    length: formatLocalizedNumber(row.length_m as number, locale),
    width: formatLocalizedNumber(row.width_m as number, locale),
    area: Number.isFinite(numericArea) ? formatLocalizedNumber(numericArea, locale) : "",
  });
}
