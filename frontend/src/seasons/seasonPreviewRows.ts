import type { SeasonPatternPreviewResponse, SeasonPeriodTransition } from '../api/types';

export interface SeasonPreviewSeasonRow {
  kind: 'season';
  year: number;
  /** The existing season's label, otherwise the start year. */
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  /** No season exists for this year yet; the row only previews the pattern. */
  isPreview: boolean;
  isLatestExisting: boolean;
}

export interface SeasonPreviewTransitionRow {
  kind: 'transition';
  transition: SeasonPeriodTransition;
}

export type SeasonPreviewRow = SeasonPreviewSeasonRow | SeasonPreviewTransitionRow;

interface ExistingSeasonPeriod {
  start_date: string;
  end_date: string;
  label?: string;
}

const startYear = (isoDate: string): number => Number(isoDate.slice(0, 4));

const rowStartDate = (row: SeasonPreviewRow): string =>
  row.kind === 'season' ? row.startDate : row.transition.start_date;

/**
 * Merges the computed pattern periods, the latest existing season and the
 * project's existing seasons into one row per year, sorted by start date.
 *
 * The preview endpoint returns the latest existing season separately from the
 * computed previous/current/next periods, so the same year can appear in both.
 * A year that already has a season shows that season's real period (a pattern
 * change never alters existing seasons); any other year is a preview. The
 * gap/overlap transition is not a season and keeps its own row.
 */
export function buildSeasonPreviewRows(
  preview: SeasonPatternPreviewResponse,
  existingSeasons: readonly ExistingSeasonPeriod[] = [],
): SeasonPreviewRow[] {
  const reference = preview.reference_season;
  const existingByYear = new Map<number, ExistingSeasonPeriod>();
  for (const season of [...existingSeasons].sort((a, b) => a.start_date.localeCompare(b.start_date))) {
    existingByYear.set(startYear(season.start_date), season);
  }
  if (reference) {
    existingByYear.set(startYear(reference.start_date), reference);
  }
  const referenceYear = reference ? startYear(reference.start_date) : null;

  const rowsByYear = new Map<number, SeasonPreviewSeasonRow>();
  const addYear = (year: number, computed: ExistingSeasonPeriod | null, isCurrent: boolean) => {
    const existing = existingByYear.get(year);
    const period = existing ?? computed;
    if (!period) return;
    const previous = rowsByYear.get(year);
    rowsByYear.set(year, {
      kind: 'season',
      year,
      label: existing?.label || String(year),
      startDate: period.start_date,
      endDate: period.end_date,
      isCurrent: isCurrent || (previous?.isCurrent ?? false),
      isPreview: !existing,
      isLatestExisting: year === referenceYear,
    });
  };

  for (const period of preview.periods) {
    addYear(startYear(period.start_date), period, period.is_current);
  }
  if (referenceYear !== null) {
    addYear(referenceYear, null, false);
  }

  const rows: SeasonPreviewRow[] = [...rowsByYear.values()];
  if (preview.transition) {
    rows.push({ kind: 'transition', transition: preview.transition });
  }
  return rows.sort((a, b) => rowStartDate(a).localeCompare(rowStartDate(b)));
}
