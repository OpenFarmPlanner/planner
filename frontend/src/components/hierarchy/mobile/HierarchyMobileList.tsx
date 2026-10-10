import { Box, IconButton, Stack, Typography, useTheme } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import NotesIcon from "@mui/icons-material/Notes";
import { useTranslation } from "../../../i18n";
import { resolveLocaleFromLanguage } from "../../../utils/numberLocalization";
import { buildHierarchySecondaryLine } from "./hierarchyMobileFormatting";
import type { MobileHierarchyRow } from "../hooks/useMobileHierarchyRows";

/** Indentation, in theme spacing units, applied per hierarchy level. */
export const INDENT_UNIT = 2;

const TOUCH_TARGET_SIZE = 44;

interface HierarchyMobileListProps {
  rows: MobileHierarchyRow[];
  expandedRows: Set<string | number>;
  onToggleExpand: (id: string | number) => void;
  onOpenRow: (row: MobileHierarchyRow) => void;
  openRowId: string | number | null;
}

export function HierarchyMobileList({
  rows,
  expandedRows,
  onToggleExpand,
  onOpenRow,
  openRowId,
}: HierarchyMobileListProps) {
  const { t, i18n } = useTranslation(["hierarchy", "common"]);
  const theme = useTheme();
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);

  return (
    <Stack spacing={1}>
      {rows.map((row) => {
        const isExpanded = expandedRows.has(row.id);
        const hasNotes = typeof row.notes === "string" && row.notes.trim().length > 0;

        return (
          <Box
            key={row.id}
            data-hierarchy-mobile-row-id={row.id}
            data-hierarchy-mobile-row-type={row.type}
            sx={{
              pl: theme.spacing(row.level * INDENT_UNIT),
              bgcolor: row.id === openRowId ? "action.selected" : "transparent",
              borderRadius: 1,
            }}
          >
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
              {row.hasChildren ? (
                <IconButton
                  sx={{ width: TOUCH_TARGET_SIZE, height: TOUCH_TARGET_SIZE, flexShrink: 0 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleExpand(row.id);
                  }}
                  aria-label={
                    isExpanded
                      ? t("hierarchy:mobile.collapse", { name: row.name })
                      : t("hierarchy:mobile.expand", { name: row.name })
                  }
                >
                  <ExpandMoreIcon
                    sx={{
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 160ms ease-in-out",
                    }}
                  />
                </IconButton>
              ) : (
                <Box sx={{ width: TOUCH_TARGET_SIZE, height: TOUCH_TARGET_SIZE, flexShrink: 0 }} />
              )}

              <Box
                component="button"
                type="button"
                onClick={() => onOpenRow(row)}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  background: "none",
                  textAlign: "left",
                  cursor: "pointer",
                  p: 1,
                  m: 0,
                  borderRadius: 1,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: TOUCH_TARGET_SIZE,
                  justifyContent: "center",
                  "&:focus-visible": {
                    outline: (activeTheme) => `2px solid ${activeTheme.palette.primary.main}`,
                    outlineOffset: 1,
                  },
                }}
              >
                <Box sx={{ display: "block" }}>
                  <Typography
                    component="span"
                    variant="body1"
                    sx={{ fontWeight: row.type === "location" ? 700 : 400, whiteSpace: "normal" }}
                  >
                    {row.name}
                  </Typography>
                  {hasNotes ? (
                    <Box
                      component="span"
                      role="img"
                      aria-label={t("hierarchy:mobile.hasNotes")}
                      sx={{
                        display: "inline-flex",
                        verticalAlign: "middle",
                        ml: 0.5,
                      }}
                    >
                      <NotesIcon fontSize="small" color="primary" />
                    </Box>
                  ) : null}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "normal" }}>
                  {buildHierarchySecondaryLine(row, t, locale)}
                </Typography>
              </Box>
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
