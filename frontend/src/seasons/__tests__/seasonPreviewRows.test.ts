import { describe, expect, it } from 'vitest';
import type { SeasonPatternPreviewResponse } from '../../api/types';
import { buildSeasonPreviewRows, type SeasonPreviewSeasonRow } from '../seasonPreviewRows';

const period = (year: number, isCurrent = false) => ({
  start_date: `${year}-01-01`,
  end_date: `${year}-12-31`,
  is_current: isCurrent,
});

const season = (year: number) => ({ start_date: `${year}-01-01`, end_date: `${year}-12-31` });

const computed2025to2027 = [period(2025), period(2026, true), period(2027)];

const preview = (overrides: Partial<SeasonPatternPreviewResponse> = {}): SeasonPatternPreviewResponse => ({
  periods: computed2025to2027,
  reference_season: null,
  transition: null,
  ...overrides,
});

const seasonRows = (rows: ReturnType<typeof buildSeasonPreviewRows>) =>
  rows.filter((row): row is SeasonPreviewSeasonRow => row.kind === 'season');

describe('buildSeasonPreviewRows', () => {
  it('lists the current year once when the latest existing season is the current one', () => {
    // The reported bug: 2026 (last existing), 2025, 2026 (current), 2027.
    const rows = seasonRows(buildSeasonPreviewRows(
      preview({ reference_season: { ...season(2026), label: '2026' } }),
      [season(2025), season(2026)],
    ));

    expect(rows.map((row) => row.year)).toEqual([2025, 2026, 2027]);
    expect(rows[1]).toMatchObject({ isCurrent: true, isLatestExisting: true, isPreview: false });
    expect(rows[0]).toMatchObject({ isCurrent: false, isLatestExisting: false, isPreview: false });
    expect(rows[2]).toMatchObject({ isCurrent: false, isLatestExisting: false, isPreview: true });
  });

  it('keeps an older latest season in order before a gap of years without seasons', () => {
    const rows = buildSeasonPreviewRows(
      preview({
        reference_season: { ...season(2022), label: '2022' },
        transition: { kind: 'gap', start_date: '2023-01-01', end_date: '2024-12-31' },
      }),
      [season(2021), season(2022)],
    );

    expect(rows.map((row) => (row.kind === 'season' ? row.year : row.transition.kind))).toEqual([
      2022, 'gap', 2025, 2026, 2027,
    ]);
    const seasons = seasonRows(rows);
    expect(seasons[0]).toMatchObject({ isLatestExisting: true, isPreview: false });
    expect(seasons.slice(1).every((row) => row.isPreview)).toBe(true);
    expect(seasons.find((row) => row.isCurrent)?.year).toBe(2026);
  });

  it('marks every computed period as a preview when no season exists yet', () => {
    const rows = seasonRows(buildSeasonPreviewRows(preview()));

    expect(rows.map((row) => row.year)).toEqual([2025, 2026, 2027]);
    expect(rows.every((row) => row.isPreview && !row.isLatestExisting)).toBe(true);
    expect(rows.filter((row) => row.isCurrent).map((row) => row.year)).toEqual([2026]);
  });

  it('shows the existing season period, not the recomputed one, for a year that exists', () => {
    // A pattern change never moves existing seasons, so their real dates win.
    const rows = seasonRows(buildSeasonPreviewRows(
      preview({
        periods: [
          { start_date: '2025-09-01', end_date: '2026-08-31', is_current: false },
          { start_date: '2026-09-01', end_date: '2027-08-31', is_current: true },
        ],
        reference_season: { ...season(2026), label: '2026' },
      }),
      [season(2025), season(2026)],
    ));

    expect(rows.map((row) => [row.year, row.startDate, row.isPreview])).toEqual([
      [2025, '2025-01-01', false],
      [2026, '2026-01-01', false],
    ]);
    expect(rows[1].isCurrent).toBe(true);
  });

  it('names existing seasons by their label and previews by their start year', () => {
    const rows = seasonRows(buildSeasonPreviewRows(
      preview({
        periods: [{ start_date: '2025-09-01', end_date: '2026-08-31', is_current: true }],
        reference_season: { start_date: '2024-09-01', end_date: '2025-08-31', label: '24/25' },
      }),
    ));

    expect(rows.map((row) => row.label)).toEqual(['24/25', '2025']);
  });

  it('sorts unordered input by start date', () => {
    const rows = seasonRows(buildSeasonPreviewRows(
      preview({ periods: [period(2027), period(2025), period(2026, true)] }),
      [season(2026), season(2025)],
    ));

    expect(rows.map((row) => row.year)).toEqual([2025, 2026, 2027]);
  });
});
