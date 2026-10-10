import { useMemo } from "react";
import type { Bed, Field, Location } from "../../../api/api";
import {
  buildHierarchyIndex,
  buildHierarchyRowsFromIndex,
  type HierarchySortConfig,
} from "../utils/hierarchyUtils";
import type { HierarchyRow } from "../utils/types";

export type MobileHierarchyRow = HierarchyRow & { childCount: number };

/**
 * Builds the flat, indentation-aware row list the mobile list view renders,
 * reusing the same `buildHierarchyIndex`/`buildHierarchyRowsFromIndex` pair
 * desktop's `FieldsBedsHierarchy.tsx` uses, plus a `childCount` per row for
 * the "N Parzellen"/"N Beete" secondary-line text.
 */
export function useMobileHierarchyRows(
  locations: Location[],
  fields: Field[],
  beds: Bed[],
  hierarchySortConfig: HierarchySortConfig | undefined,
  expandedRows: Set<string | number>,
): MobileHierarchyRow[] {
  const hierarchyIndex = useMemo(
    () => buildHierarchyIndex(locations, fields, beds, hierarchySortConfig),
    [locations, fields, beds, hierarchySortConfig],
  );

  return useMemo(() => {
    const rows = buildHierarchyRowsFromIndex(hierarchyIndex, expandedRows);
    return rows.map((row): MobileHierarchyRow => {
      let childCount = 0;
      if (row.type === "location" && typeof row.locationId === "number") {
        childCount = hierarchyIndex.fieldsByLocation.get(row.locationId)?.length ?? 0;
      } else if (row.type === "field" && typeof row.fieldId === "number") {
        childCount = hierarchyIndex.bedsByField.get(row.fieldId)?.length ?? 0;
      }
      return { ...row, childCount };
    });
  }, [hierarchyIndex, expandedRows]);
}
