import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { FocusManagerProvider } from "../focus/FocusManager";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_THRESHOLD_MS } from "../utils/contextMenu";
import YieldOverviewPage from "../pages/YieldOverview";
import { getYieldAxisLabelStep } from "../pages/yieldOverviewUtils";

const mocks = vi.hoisted(() => ({
  planList: vi.fn(),
  yieldList: vi.fn(),
  navigate: vi.fn(),
}));
const projectRequirementState = vi.hoisted(() => ({
  shouldShowProjectRequiredState: false,
  missingProjectReason: null as null | "no_projects" | "no_active_project",
}));

vi.mock("../api/api", async () => {
  const actual =
    await vi.importActual<typeof import("../api/api")>("../api/api");
  return {
    ...actual,
    plantingPlanAPI: { list: mocks.planList },
    yieldCalendarAPI: { list: mocks.yieldList },
  };
});

vi.mock("../hooks/useProjectRequirement", () => ({
  useProjectRequirement: () => projectRequirementState,
}));

const outletContext = vi.hoisted(() => ({
  activeSeasonYear: null as number | null,
  activeSeason: null as null | { start_date: string; end_date: string },
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useOutletContext: () => outletContext,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  outletContext.activeSeasonYear = null;
  outletContext.activeSeason = null;
  projectRequirementState.shouldShowProjectRequiredState = false;
  projectRequirementState.missingProjectReason = null;
  mocks.planList.mockResolvedValue({
    data: {
      results: [
        {
          id: 10,
          crop: 1,
          crop_name: "Kohl",
          bed: 3,
          planting_date: "2026-03-01",
        },
      ],
    },
  });
  mocks.yieldList.mockResolvedValue({ data: [] });
});

describe("YieldOverviewPage", () => {
  it("shows every label when columns have enough horizontal space", () => {
    expect(getYieldAxisLabelStep(360, 3, "week")).toBe(1);
    expect(getYieldAxisLabelStep(720, 12, "month")).toBe(1);
  });

  it("progressively reduces label density when columns become narrow", () => {
    expect(getYieldAxisLabelStep(360, 20, "week")).toBe(2);
    expect(getYieldAxisLabelStep(360, 40, "week")).toBe(4);
    expect(getYieldAxisLabelStep(360, 12, "month")).toBe(2);
  });

  it("fills empty yield weeks between available week entries", async () => {
    mocks.yieldList.mockResolvedValue({
      data: [
        {
          iso_week: "2026-W13",
          week_start: "2026-03-23",
          crops: [
            {
              crop_id: 1,
              crop_name: "Kohl",
              yield: 0.7,
              color: "#16a34a",
            },
          ],
        },
        {
          iso_week: "2026-W15",
          week_start: "2026-04-06",
          crops: [
            {
              crop_id: 1,
              crop_name: "Kohl",
              yield: 0.9,
              color: "#16a34a",
            },
          ],
        },
      ],
    });

    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Ertragsverteilung" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("W13")).toBeInTheDocument();
    expect(screen.getByText("W14")).toBeInTheDocument();
    expect(screen.getByText("W15")).toBeInTheDocument();
    expect(screen.getByText("W13")).toHaveStyle({ visibility: "visible" });
    expect(screen.getByText("W14")).toHaveStyle({ visibility: "visible" });
    expect(screen.getByText("W15")).toHaveStyle({ visibility: "visible" });
    expect(screen.getByTestId("yield-chart-plot")).toHaveStyle({
      width: "100%",
    });
    expect(screen.getByTestId("yield-bar-column-2026-W13")).toHaveStyle({
      flex: "1 1 0",
    });
    expect(screen.getByTestId("yield-axis-column-2026-W13")).toHaveStyle({
      flex: "1 1 0",
    });
    expect(screen.getByLabelText("Kultur")).toHaveTextContent("Alle Kulturen");
    expect(screen.queryByLabelText("Jahr")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Woche" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("heading", { name: "Ertragsübersicht" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Bereit für weitere Ertragsauswertungen"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Zum Anbaukalender" }),
    ).not.toBeInTheDocument();

    fireEvent.mouseOver(screen.getByTestId("yield-bar-2026-W13-1"));
    expect(await screen.findByText("W13 Mär")).toBeInTheDocument();
    expect(screen.getByText("0.70 kg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Monat" }));

    expect(screen.getByRole("button", { name: "Monat" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Mär")).toHaveStyle({ visibility: "visible" });
    expect(screen.getByText("Apr")).toHaveStyle({ visibility: "visible" });
  });

  it("offers a context menu on a yield segment to open the crop or copy its summary", async () => {
    mocks.yieldList.mockResolvedValue({
      data: [
        {
          iso_week: "2026-W13",
          week_start: "2026-03-23",
          crops: [
            { crop_id: 1, crop_name: "Kohl", yield: 0.7, color: "#16a34a" },
          ],
        },
      ],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

    const segment = await screen.findByTestId("yield-bar-2026-W13-1");
    fireEvent.contextMenu(segment);

    expect(await screen.findByRole("menuitem", { name: "Kultur öffnen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Kultur öffnen" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/app/crops?cropId=1");

    fireEvent.contextMenu(segment);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Zeile kopieren" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Kohl · W13 Mär · 0.70 kg"));
  });

  it("uses localized crop display names in the chart and crop filter", async () => {
    mocks.yieldList.mockResolvedValue({
      data: [
        {
          iso_week: "2026-W13",
          week_start: "2026-03-23",
          crops: [
            {
              crop_id: 1,
              crop_name: "Ackerbohne",
              crop_display_name: "Broad bean",
              crop_display_language_code: "en",
              yield: 0.7,
              color: "#16a34a",
            },
          ],
        },
      ],
    });

    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

    expect(await screen.findByTestId("yield-bar-2026-W13-1")).toHaveAccessibleName(/Broad bean/);
    expect(screen.getByRole("button", { name: "Broad bean 0,7 kg" })).toBeInTheDocument();
    expect(screen.getByLabelText("Kultur")).toHaveTextContent("Alle Kulturen");
    expect(screen.queryByText("Ackerbohne")).not.toBeInTheDocument();
  });

  describe("keyboard navigation on the chart bars", () => {
    beforeEach(() => {
      mocks.yieldList.mockResolvedValue({
        data: [
          {
            iso_week: "2026-W13",
            week_start: "2026-03-23",
            crops: [
              { crop_id: 1, crop_name: "Kohl", yield: 0.7, color: "#16a34a" },
              { crop_id: 2, crop_name: "Karotte", yield: 0.5, color: "#f97316" },
            ],
          },
          {
            iso_week: "2026-W14",
            week_start: "2026-03-30",
            crops: [
              { crop_id: 1, crop_name: "Kohl", yield: 0.9, color: "#16a34a" },
              { crop_id: 2, crop_name: "Karotte", yield: 0.4, color: "#f97316" },
            ],
          },
        ],
      });
    });

    it("moves focus between periods with ArrowRight/ArrowLeft", async () => {
      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );

      const week13Kohl = await screen.findByTestId("yield-bar-2026-W13-1");
      const week14Kohl = screen.getByTestId("yield-bar-2026-W14-1");

      fireEvent.keyDown(week13Kohl, { key: "ArrowRight" });
      expect(week14Kohl).toHaveFocus();

      fireEvent.keyDown(week14Kohl, { key: "ArrowLeft" });
      expect(week13Kohl).toHaveFocus();
    });

    it("moves focus between stacked crops within a period with ArrowUp/ArrowDown", async () => {
      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );

      const week13Kohl = await screen.findByTestId("yield-bar-2026-W13-1");
      const week13Karotte = screen.getByTestId("yield-bar-2026-W13-2");

      fireEvent.keyDown(week13Kohl, { key: "ArrowUp" });
      expect(week13Karotte).toHaveFocus();

      fireEvent.keyDown(week13Karotte, { key: "ArrowDown" });
      expect(week13Kohl).toHaveFocus();
    });

    it("opens the crop with Enter", async () => {
      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );

      const week13Karotte = await screen.findByTestId("yield-bar-2026-W13-2");
      fireEvent.keyDown(week13Karotte, { key: "Enter" });

      expect(mocks.navigate).toHaveBeenCalledWith("/app/crops?cropId=2");
    });

    it("toggles the tooltip open with Space", async () => {
      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );

      const week13Kohl = await screen.findByTestId("yield-bar-2026-W13-1");
      expect(screen.queryByText("0.70 kg")).not.toBeInTheDocument();

      fireEvent.keyDown(week13Kohl, { key: " " });
      expect(await screen.findByText("0.70 kg")).toBeInTheDocument();

      fireEvent.keyDown(week13Kohl, { key: " " });
      await waitFor(() => expect(screen.queryByText("0.70 kg")).not.toBeInTheDocument());
    });

    it("opens the context menu at the focused segment with the ContextMenu key", async () => {
      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );

      const week13Kohl = await screen.findByTestId("yield-bar-2026-W13-1");
      fireEvent.keyDown(week13Kohl, { key: "ContextMenu" });

      expect(await screen.findByRole("menuitem", { name: "Kultur öffnen" })).toBeInTheDocument();
    });
  });

  describe("mobile long-press behavior on yield segments", () => {
    beforeEach(() => {
      mocks.yieldList.mockResolvedValue({
        data: [
          {
            iso_week: "2026-W13",
            week_start: "2026-03-23",
            crops: [
              { crop_id: 1, crop_name: "Kohl", yield: 0.7, color: "#16a34a" },
            ],
          },
        ],
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("never permanently shows the three-dot context-menu icon", async () => {
      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );
      await screen.findByTestId("yield-bar-2026-W13-1");

      const indicator = screen.getByRole("button", { name: "Aktionen" });
      expect(getComputedStyle(indicator).opacity).toBe("0");
      expect(getComputedStyle(indicator).pointerEvents).toBe("none");
    });

    it("opens the context menu after a long press", async () => {
      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );
      const segment = await screen.findByTestId("yield-bar-2026-W13-1");

      vi.useFakeTimers();
      fireEvent.touchStart(segment, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS);
      });
      vi.useRealTimers();

      expect(await screen.findByRole("menuitem", { name: "Kultur öffnen" })).toBeInTheDocument();
    });

    it("does not open the context menu on a short tap", async () => {
      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );
      const segment = await screen.findByTestId("yield-bar-2026-W13-1");

      vi.useFakeTimers();
      fireEvent.touchStart(segment, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
      fireEvent.touchEnd(segment);
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS);
      });
      vi.useRealTimers();

      expect(screen.queryByRole("menuitem", { name: "Kultur öffnen" })).not.toBeInTheDocument();
    });

    it("cancels the long press when the touch moves (scroll/drag)", async () => {
      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );
      const segment = await screen.findByTestId("yield-bar-2026-W13-1");

      vi.useFakeTimers();
      fireEvent.touchStart(segment, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
      fireEvent.touchMove(segment, { touches: [{ identifier: 1, clientX: 60, clientY: 60 }] });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS);
      });
      vi.useRealTimers();

      expect(screen.queryByRole("menuitem", { name: "Kultur öffnen" })).not.toBeInTheDocument();
    });
  });

  it("shows a helpful empty state when no planting plans exist", async () => {
    mocks.planList.mockResolvedValue({ data: { results: [] } });

    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

    expect(
      await screen.findByText("Noch keine Ertragsprognose verfügbar"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ertragsprognosen werden verfügbar, sobald Anbaupläne mit Erntezeiträumen vorhanden sind.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Anbauplan hinzufügen" }),
    ).toHaveAttribute("href", "/app/planting-plans?create=true");
  });

  it("shows a yield-data empty state when planting plans have no calculable yields", async () => {
    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

    expect(
      await screen.findByText("Keine erwarteten Erträge in dieser Saison"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Für die aktive Saison sind keine Erntedaten vorhanden. Stelle sicher, dass deine Kulturen erwartete Erträge eingetragen haben.",
      ),
    ).toBeInTheDocument();
  });

  it("requests yield data scoped to the active season, without a year parameter", async () => {
    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

    await screen.findByText("Keine erwarteten Erträge in dieser Saison");
    expect(mocks.yieldList).toHaveBeenCalledWith();
  });

  describe("legend", () => {
    const buildWeek = (id: number, crops: { crop_id: number; crop_name: string; yield: number }[]) => ({
      iso_week: `2026-W${String(id).padStart(2, "0")}`,
      week_start: `2026-03-${String(id).padStart(2, "0")}`,
      crops: crops.map((crop) => ({ ...crop, color: "#16a34a" })),
    });

    it("orders the legend by total visible yield (descending), not alphabetically", async () => {
      mocks.yieldList.mockResolvedValue({
        data: [
          buildWeek(2, [
            { crop_id: 1, crop_name: "Aprikose", yield: 0.5 },
            { crop_id: 2, crop_name: "Zucchini", yield: 5 },
            { crop_id: 3, crop_name: "Möhre", yield: 2 },
          ]),
        ],
      });

      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );

      await screen.findByRole("heading", { name: "Ertragsverteilung" });
      const legendNames = screen.getAllByText(/^(Aprikose|Zucchini|Möhre)$/).map((el) => el.textContent);
      expect(legendNames).toEqual(["Zucchini", "Möhre", "Aprikose"]);
      expect(screen.getByRole("button", { name: "Zucchini 5 kg" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Aprikose 0,5 kg" })).toBeInTheDocument();
    });

    it("shows the full legend without a toggle for 12 or fewer crops", async () => {
      const crops = Array.from({ length: 12 }, (_, index) => ({
        crop_id: index + 1,
        crop_name: `Kultur ${index + 1}`,
        yield: 12 - index,
      }));
      mocks.yieldList.mockResolvedValue({ data: [buildWeek(2, crops)] });

      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );

      await screen.findByRole("heading", { name: "Ertragsverteilung" });
      expect(screen.getByText("Kultur 1")).toBeInTheDocument();
      expect(screen.getByText("Kultur 12")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Mehr anzeigen|Kulturen anzeigen|Weitere/ })).not.toBeInTheDocument();
    });

    it("shows the top 15 legend entries and can expand or collapse the remaining crops", async () => {
      const crops = Array.from({ length: 17 }, (_, index) => ({
        crop_id: index + 1,
        crop_name: `Kultur ${index + 1}`,
        yield: 17 - index,
      }));
      mocks.yieldList.mockResolvedValue({ data: [buildWeek(2, crops)] });

      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );

      await screen.findByRole("heading", { name: "Ertragsverteilung" });
      expect(screen.getByText("Kultur 1")).toBeInTheDocument();
      expect(screen.getByText("Kultur 15")).toBeInTheDocument();
      expect(screen.queryByText("Kultur 16")).not.toBeInTheDocument();
      expect(screen.queryByText("Kultur 17")).not.toBeInTheDocument();
      const showMoreButton = screen.getByRole("button", { name: "Weitere 2 anzeigen" });

      fireEvent.click(showMoreButton);

      expect(await screen.findByText("Kultur 17")).toBeInTheDocument();
      const collapseButton = screen.getByRole("button", { name: "Auf Top 15 reduzieren" });

      fireEvent.click(collapseButton);

      expect(screen.queryByText("Kultur 16")).not.toBeInTheDocument();
    });

    it("highlights a clicked legend crop and dims other chart segments", async () => {
      mocks.yieldList.mockResolvedValue({
        data: [
          buildWeek(13, [
            { crop_id: 1, crop_name: "Kohl", yield: 5 },
            { crop_id: 2, crop_name: "Karotte", yield: 2 },
          ]),
        ],
      });

      render(
        <FocusManagerProvider><MemoryRouter>
          <YieldOverviewPage />
        </MemoryRouter></FocusManagerProvider>,
      );

      const kohlLegendButton = await screen.findByRole("button", { name: "Kohl 5 kg" });
      const kohlSegment = screen.getByTestId("yield-bar-2026-W13-1");
      const carrotSegment = screen.getByTestId("yield-bar-2026-W13-2");

      fireEvent.click(kohlLegendButton);

      expect(kohlLegendButton).toHaveAttribute("aria-pressed", "true");
      expect(kohlSegment).toHaveStyle({ opacity: "1" });
      expect(carrotSegment).toHaveStyle({ opacity: "0.28" });

      fireEvent.click(kohlLegendButton);

      expect(kohlLegendButton).toHaveAttribute("aria-pressed", "false");
      expect(carrotSegment).toHaveStyle({ opacity: "1" });
    });
  });

  it("renders a year-boundary marker when the active season straddles a calendar year", async () => {
    outletContext.activeSeason = { start_date: "2025-09-01", end_date: "2026-08-31" };
    mocks.yieldList.mockResolvedValue({
      data: [
        {
          iso_week: "2025-W52",
          week_start: "2025-12-22",
          crops: [{ crop_id: 1, crop_name: "Kohl", yield: 1, color: "#16a34a" }],
        },
        {
          iso_week: "2026-W02",
          week_start: "2026-01-05",
          crops: [{ crop_id: 1, crop_name: "Kohl", yield: 1, color: "#16a34a" }],
        },
      ],
    });

    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("yield-year-boundary-marker"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Jahreswechsel: 2025 → 2026")).toBeInTheDocument();
  });

  it("renders no year-boundary marker for a calendar-aligned season", async () => {
    outletContext.activeSeason = { start_date: "2026-01-01", end_date: "2026-12-31" };
    mocks.yieldList.mockResolvedValue({
      data: [
        {
          iso_week: "2026-W02",
          week_start: "2026-01-05",
          crops: [{ crop_id: 1, crop_name: "Kohl", yield: 1, color: "#16a34a" }],
        },
      ],
    });

    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

    await screen.findByRole("heading", { name: "Ertragsverteilung" });
    expect(
      screen.queryByTestId("yield-year-boundary-marker"),
    ).not.toBeInTheDocument();
  });
});

/**
 * The chart tree below the page: the stacked bars, their keyboard model, the
 * legend, the axes and the year-boundary marker. Driven through the page
 * rather than by rendering `YieldDistributionChart` directly, because the
 * data the chart reasons about (filled-in empty weeks, month grouping, the
 * crop ordering behind the legend) is shaped by `useYieldChartData` from the
 * API rows, and a hand-built `chartData` prop would let the fixtures drift
 * away from anything the backend can actually return.
 *
 * Five things in this tree are deliberately left unpinned, because breaking
 * them changes nothing any test could observe:
 *
 * - `event.key === "Spacebar"` in the segment key handler is unreachable.
 *   React normalizes the legacy key names in its synthetic events, so a
 *   browser reporting "Spacebar" arrives at the handler as " ". The behaviour
 *   is covered; the second half of that condition simply never runs.
 * - The `shouldOpenCustomContextMenu` re-check inside `openContextMenu`, and
 *   the `payload` null check in the long-press callback, are defensive. A
 *   segment contains no editable element, and the payload is always written
 *   by the touch start that arms the press.
 * - Clearing `pressedSegmentKey` on touch move and touch end is belt and
 *   braces: the pressed styling also requires `isLongPressing`, which the
 *   long-press hook clears on both events anyway.
 * - Deleting from the segment-element registry when a segment unmounts is
 *   memory hygiene. A segment that comes back registers under the same key
 *   and overwrites the stale entry, so no fixture can tell the two apart.
 * - `data-rmg-component="yield-segment"` is read by the shared context-menu
 *   plumbing (covered in `contextMenu.test.tsx`). Both paths it feeds end in
 *   the same place here: a right-click on another bar either repositions the
 *   menu, or closes it and immediately reopens it from the segment's own
 *   handler.
 */
describe("YieldDistributionChart", () => {
  const week = (
    isoWeek: string,
    weekStart: string,
    crops: { crop_id: number; crop_name: string; yield: number; color?: string }[],
  ) => ({
    iso_week: isoWeek,
    week_start: weekStart,
    crops: crops.map((crop) => ({ color: "#16a34a", ...crop })),
  });

  const KOHL = { crop_id: 1, crop_name: "Kohl" };
  const KAROTTE = { crop_id: 2, crop_name: "Karotte" };

  const renderPage = () =>
    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

  /**
   * jsdom reports every element as 0x0 and ships no `ResizeObserver`, so both
   * measuring effects in this tree (the axis width and the marker position)
   * take their `window.addEventListener("resize", ...)` fallback and start
   * from a width of zero. Stubbing the rects and firing a resize is the only
   * way to reach the code that depends on real geometry — without it the
   * label-thinning maths is never exercised, and the marker's offset is
   * indistinguishable from a raw viewport coordinate because both are 0.
   */
  const measure = (rects: { element: HTMLElement; rect: Partial<DOMRect> }[]): void => {
    rects.forEach(({ element, rect }) => {
      element.getBoundingClientRect = () => rect as DOMRect;
    });
    fireEvent(window, new Event("resize"));
  };

  const plotArea = (): HTMLElement =>
    screen.getByTestId("yield-chart-plot").parentElement as HTMLElement;

  describe("stacked bars", () => {
    beforeEach(() => {
      mocks.yieldList.mockResolvedValue({
        data: [
          week("2026-W13", "2026-03-23", [
            { ...KOHL, yield: 4 },
            { ...KAROTTE, yield: 2 },
          ]),
          week("2026-W14", "2026-03-30", [{ ...KOHL, yield: 1 }]),
        ],
      });
    });

    it("scales every segment against the tallest column, not its own total", async () => {
      renderPage();

      // W13 totals 6 and is the tallest column, so its two crops take 4/6 and
      // 2/6 of the plot. W14's single crop is 1/6 -- if each column were
      // normalized to itself it would fill the height instead, and a thin
      // week would read as a bumper harvest.
      expect(await screen.findByTestId("yield-bar-2026-W13-1")).toHaveStyle({
        height: `${(4 / 6) * 100}%`,
      });
      expect(screen.getByTestId("yield-bar-2026-W13-2")).toHaveStyle({
        height: `${(2 / 6) * 100}%`,
      });
      expect(screen.getByTestId("yield-bar-2026-W14-1")).toHaveStyle({
        height: `${(1 / 6) * 100}%`,
      });
    });

    it("names the crop, the period and the exact yield for a screen reader", async () => {
      renderPage();

      // Two decimals, not the legend's rounded figure: the bar is the only
      // place the precise number is available to someone who cannot see the
      // tooltip.
      expect(await screen.findByTestId("yield-bar-2026-W13-1")).toHaveAccessibleName(
        "Kohl, W13 Mär, 4.00 kg",
      );
    });
  });

  describe("columns with no yield", () => {
    it("gives a zero-yield crop no bar at all", async () => {
      mocks.yieldList.mockResolvedValue({
        data: [
          week("2026-W13", "2026-03-23", [
            { ...KOHL, yield: 4 },
            { ...KAROTTE, yield: 0 },
          ]),
        ],
      });
      renderPage();

      // The 2px floor exists so a very small harvest stays visible; a crop
      // with nothing harvested must not borrow it, or every crop in the
      // legend would appear to have yielded something.
      expect(await screen.findByTestId("yield-bar-2026-W13-2")).toHaveStyle({
        height: "0%",
        minHeight: "0px",
      });
      expect(screen.getByTestId("yield-bar-2026-W13-1")).toHaveStyle({ minHeight: "2px" });
    });

    it("draws flat bars rather than NaN ones when nothing has a yield", async () => {
      mocks.yieldList.mockResolvedValue({
        data: [week("2026-W13", "2026-03-23", [{ ...KOHL, yield: 0 }])],
      });
      renderPage();

      // Every segment is divided by the chart's maximum, which is 0 here.
      expect(await screen.findByTestId("yield-bar-2026-W13-1")).toHaveStyle({ height: "0%" });
    });

    it("shows a single zero tick instead of five identical ones", async () => {
      mocks.yieldList.mockResolvedValue({
        data: [week("2026-W13", "2026-03-23", [{ ...KOHL, yield: 0 }])],
      });
      renderPage();
      await screen.findByRole("heading", { name: "Ertragsverteilung" });

      expect(screen.getAllByText(/kg$/, { selector: "span" }).filter(
        (element) => /^\d+\.\d kg$/.test(element.textContent ?? ""),
      )).toHaveLength(1);
      expect(screen.getByText("0.0 kg")).toBeInTheDocument();
    });
  });

  describe("y axis", () => {
    it("spreads five ticks from zero to the tallest column", async () => {
      mocks.yieldList.mockResolvedValue({
        data: [
          week("2026-W13", "2026-03-23", [
            { ...KOHL, yield: 4 },
            { ...KAROTTE, yield: 2 },
          ]),
        ],
      });
      renderPage();
      await screen.findByRole("heading", { name: "Ertragsverteilung" });

      // Evenly spaced across four gaps, so the top tick is the maximum
      // itself: dividing by the tick count instead would leave the tallest
      // bar rising past the last labelled line.
      ["0.0 kg", "1.5 kg", "3.0 kg", "4.5 kg", "6.0 kg"].forEach((tick) => {
        expect(screen.getByText(tick)).toBeInTheDocument();
      });
    });
  });

  describe("x axis labels", () => {
    const twentyWeeks = Array.from({ length: 20 }, (_, index) => {
      const start = new Date(2026, 2, 2 + index * 7);
      const pad = (value: number) => String(value).padStart(2, "0");
      return week(
        `2026-W${pad(index + 10)}`,
        `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
        [{ ...KOHL, yield: 1 }],
      );
    });

    it("thins week labels once the columns are measured as too narrow", async () => {
      mocks.yieldList.mockResolvedValue({ data: twentyWeeks });
      renderPage();
      await screen.findByRole("heading", { name: "Ertragsverteilung" });

      // Unmeasured, every label is drawn -- the chart must not hide labels
      // it has no reason to believe are crowded.
      expect(screen.getByText("W11")).toHaveStyle({ visibility: "visible" });

      // 360px across 20 columns is 18px each, under the 36px a week label
      // needs, so every second one is hidden.
      measure([{ element: plotArea(), rect: { width: 360 } }]);

      await waitFor(() => expect(screen.getByText("W11")).toHaveStyle({ visibility: "hidden" }));
      expect(screen.getByText("W10")).toHaveStyle({ visibility: "visible" });
      expect(screen.getByText("W12")).toHaveStyle({ visibility: "visible" });
    });

    it("keeps all labels once the columns are wide enough again", async () => {
      mocks.yieldList.mockResolvedValue({ data: twentyWeeks });
      renderPage();
      await screen.findByRole("heading", { name: "Ertragsverteilung" });

      measure([{ element: plotArea(), rect: { width: 360 } }]);
      await waitFor(() => expect(screen.getByText("W11")).toHaveStyle({ visibility: "hidden" }));

      measure([{ element: plotArea(), rect: { width: 1440 } }]);

      await waitFor(() => expect(screen.getByText("W11")).toHaveStyle({ visibility: "visible" }));
    });

    it("gives month labels more room than week labels at the same width", async () => {
      mocks.yieldList.mockResolvedValue({ data: twentyWeeks });
      renderPage();
      await screen.findByRole("heading", { name: "Ertragsverteilung" });

      // Five months at 280px is 56px each -- exactly a month label's minimum,
      // so all five stay. A week label would fit in that space twice over,
      // which is why the two periods cannot share one threshold.
      fireEvent.click(screen.getByRole("button", { name: "Monat" }));
      measure([{ element: plotArea(), rect: { width: 280 } }]);

      await waitFor(() =>
        expect(screen.getByText("Mär")).toHaveStyle({ visibility: "visible" }),
      );
      ["Apr", "Mai", "Jun", "Jul"].forEach((month) => {
        expect(screen.getByText(month)).toHaveStyle({ visibility: "visible" });
      });
    });
  });
});

/**
 * The chart is one composite tab stop, not a few hundred: exactly one segment
 * is reachable with Tab and the arrow keys move that stop around inside the
 * plot. The reference implementation for chart regions described in
 * docs/keyboard-architecture.md.
 */
describe("YieldDistributionChart roving tab stop", () => {
  const week = (
    isoWeek: string,
    weekStart: string,
    crops: { crop_id: number; crop_name: string; yield: number }[],
  ) => ({
    iso_week: isoWeek,
    week_start: weekStart,
    crops: crops.map((crop) => ({ color: "#16a34a", ...crop })),
  });

  const KOHL = { crop_id: 1, crop_name: "Kohl" };
  const KAROTTE = { crop_id: 2, crop_name: "Karotte" };

  const renderPage = () =>
    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

  beforeEach(() => {
    // W13 stacks two crops, W14 only one, so a sideways move from the upper
    // crop has no counterpart to land on and has to clamp.
    mocks.yieldList.mockResolvedValue({
      data: [
        week("2026-W13", "2026-03-23", [
          { ...KOHL, yield: 4 },
          { ...KAROTTE, yield: 2 },
        ]),
        week("2026-W14", "2026-03-30", [{ ...KOHL, yield: 1 }]),
      ],
    });
  });

  it("puts exactly one segment in the tab order and moves it with the arrows", async () => {
    renderPage();
    const first = await screen.findByTestId("yield-bar-2026-W13-1");

    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("yield-bar-2026-W13-2")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("yield-bar-2026-W14-1")).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(first, { key: "ArrowRight" });

    // Tabbing away and back must return to where the user left off, not to
    // the start of the chart.
    expect(screen.getByTestId("yield-bar-2026-W14-1")).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
  });

  it("starts at the earliest period's bottom crop", async () => {
    renderPage();
    await screen.findByTestId("yield-bar-2026-W13-1");

    // The bottom of the first column: the stack renders column-reverse, so
    // the first crop in the array is the one drawn at the axis.
    expect(screen.getByTestId("yield-bar-2026-W13-1")).toHaveAttribute("tabindex", "0");
  });

  it("falls back to the first segment when the focused one leaves the chart", async () => {
    const user = userEvent.setup();
    renderPage();
    const karotte = await screen.findByTestId("yield-bar-2026-W13-2");

    fireEvent.focus(karotte);
    expect(karotte).toHaveAttribute("tabindex", "0");

    // Filtering the chart down to Kohl takes the remembered segment with it.
    // Without the fallback the tab stop would point at a key that no longer
    // exists and the whole chart would drop out of the tab order.
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Kohl" }));

    await waitFor(() =>
      expect(screen.queryByTestId("yield-bar-2026-W13-2")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("yield-bar-2026-W13-1")).toHaveAttribute("tabindex", "0");
  });

  it("clamps to the tallest available crop when the next period is shorter", async () => {
    renderPage();
    await screen.findByTestId("yield-bar-2026-W13-1");
    const upperCrop = screen.getByTestId("yield-bar-2026-W13-2");

    fireEvent.keyDown(upperCrop, { key: "ArrowRight" });

    // W14 has no second crop; landing on nothing would strand the focus.
    expect(screen.getByTestId("yield-bar-2026-W14-1")).toHaveFocus();
  });

  it("stops at the first and last period rather than wrapping around", async () => {
    renderPage();
    const first = await screen.findByTestId("yield-bar-2026-W13-1");
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowLeft" });

    expect(first).toHaveFocus();

    const last = screen.getByTestId("yield-bar-2026-W14-1");
    last.focus();

    fireEvent.keyDown(last, { key: "ArrowRight" });

    expect(last).toHaveFocus();
  });

  it("stops at the top and bottom of a stack", async () => {
    renderPage();
    const bottom = await screen.findByTestId("yield-bar-2026-W13-1");
    bottom.focus();

    fireEvent.keyDown(bottom, { key: "ArrowDown" });

    expect(bottom).toHaveFocus();

    const top = screen.getByTestId("yield-bar-2026-W13-2");
    top.focus();

    fireEvent.keyDown(top, { key: "ArrowUp" });

    expect(top).toHaveFocus();
  });

  it("claims the arrow keys so the page does not scroll underneath", async () => {
    renderPage();
    const first = await screen.findByTestId("yield-bar-2026-W13-1");

    expect(fireEvent.keyDown(first, { key: "ArrowRight" })).toBe(false);
    expect(fireEvent.keyDown(screen.getByTestId("yield-bar-2026-W14-1"), { key: "ArrowLeft" }))
      .toBe(false);
    expect(fireEvent.keyDown(first, { key: "ArrowUp" })).toBe(false);
    expect(fireEvent.keyDown(screen.getByTestId("yield-bar-2026-W13-2"), { key: "ArrowDown" }))
      .toBe(false);
  });

  it("leaves the arrow keys alone at the edges, where it does nothing with them", async () => {
    renderPage();
    const first = await screen.findByTestId("yield-bar-2026-W13-1");

    // Nothing to move to, so the key belongs to the page again -- swallowing
    // it would trap a scroll at the edge of the chart.
    expect(fireEvent.keyDown(first, { key: "ArrowLeft" })).toBe(true);
    expect(fireEvent.keyDown(first, { key: "ArrowDown" })).toBe(true);
  });

  it("closes a keyboard tooltip when the focus moves on", async () => {
    renderPage();
    const first = await screen.findByTestId("yield-bar-2026-W13-1");

    fireEvent.keyDown(first, { key: " " });
    expect(await screen.findByText("4.00 kg")).toBeInTheDocument();

    fireEvent.keyDown(first, { key: "ArrowRight" });

    // Otherwise the tooltip would hang over a segment the user has left.
    await waitFor(() => expect(screen.queryByText("4.00 kg")).not.toBeInTheDocument());
  });

  it("toggles the tooltip for a browser that reports Space by its legacy name", async () => {
    renderPage();
    const first = await screen.findByTestId("yield-bar-2026-W13-1");

    fireEvent.keyDown(first, { key: "Spacebar" });

    expect(await screen.findByText("4.00 kg")).toBeInTheDocument();

    fireEvent.keyDown(first, { key: "Spacebar" });

    await waitFor(() => expect(screen.queryByText("4.00 kg")).not.toBeInTheDocument());
  });

  it("opens the context menu with Shift+F10 but leaves plain F10 to the browser", async () => {
    renderPage();
    const first = await screen.findByTestId("yield-bar-2026-W13-1");

    fireEvent.keyDown(first, { key: "F10" });

    expect(screen.queryByRole("menuitem", { name: "Kultur öffnen" })).not.toBeInTheDocument();

    fireEvent.keyDown(first, { key: "F10", shiftKey: true });

    expect(await screen.findByRole("menuitem", { name: "Kultur öffnen" })).toBeInTheDocument();
  });

  it("anchors the keyboard context menu to the bottom of the focused segment", async () => {
    renderPage();
    const first = await screen.findByTestId("yield-bar-2026-W13-1");
    first.getBoundingClientRect = () =>
      ({ left: 120, top: 40, bottom: 300 }) as DOMRect;

    fireEvent.keyDown(first, { key: "ContextMenu" });

    // Anchoring at the top would put the menu over the bar it describes.
    const menu = (await screen.findByRole("menuitem", { name: "Kultur öffnen" }))
      .closest(".MuiPopover-paper") as HTMLElement;
    expect(menu).toHaveStyle({ left: "122px", top: "294px" });
  });
});

describe("YieldDistributionChart segment affordances", () => {
  const week = (
    isoWeek: string,
    weekStart: string,
    crops: { crop_id: number; crop_name: string; yield: number }[],
  ) => ({
    iso_week: isoWeek,
    week_start: weekStart,
    crops: crops.map((crop) => ({ color: "#16a34a", ...crop })),
  });

  const KOHL = { crop_id: 1, crop_name: "Kohl" };
  const KAROTTE = { crop_id: 2, crop_name: "Karotte" };

  const renderPage = () =>
    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

  beforeEach(() => {
    mocks.yieldList.mockResolvedValue({
      data: [
        week("2026-W13", "2026-03-23", [
          { ...KOHL, yield: 4 },
          { ...KAROTTE, yield: 2 },
        ]),
        week("2026-W14", "2026-03-30", [{ ...KOHL, yield: 1 }]),
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the per-segment actions button out of the tab order", async () => {
    renderPage();
    await screen.findByTestId("yield-bar-2026-W13-1");

    // One tab stop per segment, and it is the segment itself -- otherwise
    // tabbing through a season would mean hundreds of stops on an icon that
    // is invisible until hover.
    screen.getAllByRole("button", { name: "Aktionen" }).forEach((indicator) => {
      expect(indicator).toHaveAttribute("tabindex", "-1");
    });
  });

  it("opens the segment's menu from its actions button", async () => {
    renderPage();
    await screen.findByTestId("yield-bar-2026-W13-1");

    fireEvent.click(screen.getAllByRole("button", { name: "Aktionen" })[0]);

    expect(await screen.findByRole("menuitem", { name: "Kultur öffnen" })).toBeInTheDocument();
  });

  it("marks the pressed segment while a long press is building", async () => {
    renderPage();
    const segment = await screen.findByTestId("yield-bar-2026-W13-1");

    vi.useFakeTimers();
    fireEvent.touchStart(segment, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });

    // Feedback that the press has registered, shown only while the threshold
    // is still running -- once the menu is open it has served its purpose.
    expect(segment).toHaveAttribute("data-long-pressing", "true");
    expect(screen.getByTestId("yield-bar-2026-W13-2")).not.toHaveAttribute("data-long-pressing");

    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS);
    });
    vi.useRealTimers();

    expect(segment).not.toHaveAttribute("data-long-pressing");
  });

  it("releases the pressed segment when the finger lifts", async () => {
    renderPage();
    const segment = await screen.findByTestId("yield-bar-2026-W13-1");

    fireEvent.touchStart(segment, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
    expect(segment).toHaveAttribute("data-long-pressing", "true");

    fireEvent.touchEnd(segment);

    expect(segment).not.toHaveAttribute("data-long-pressing");
  });

  it("releases the pressed segment when the touch turns into a scroll", async () => {
    renderPage();
    const segment = await screen.findByTestId("yield-bar-2026-W13-1");

    fireEvent.touchStart(segment, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(segment, { touches: [{ identifier: 1, clientX: 60, clientY: 60 }] });

    // Scrolling a chart on a phone starts with a finger on a bar; it must not
    // leave that bar looking pressed for the rest of the session.
    expect(segment).not.toHaveAttribute("data-long-pressing");
  });

  it("suppresses the browser's own menu when opening its own", async () => {
    renderPage();
    const segment = await screen.findByTestId("yield-bar-2026-W13-1");

    expect(fireEvent.contextMenu(segment)).toBe(false);
    expect(await screen.findByRole("menuitem", { name: "Kultur öffnen" })).toBeInTheDocument();
  });

  it("keeps a hovered tooltip open when a segment the pointer already left reports a leave", async () => {
    renderPage();
    const kohl13 = await screen.findByTestId("yield-bar-2026-W13-1");

    fireEvent.mouseEnter(kohl13);
    expect(await screen.findByText("4.00 kg")).toBeInTheDocument();

    // A leave for a different segment is stale by definition -- clearing the
    // hover unconditionally would close the tooltip the pointer is on.
    fireEvent.mouseLeave(screen.getByTestId("yield-bar-2026-W14-1"));

    // A real pause, long enough for MUI's exit transition to have run to
    // completion. Asserting straight away would pass even if the tooltip had
    // already begun closing, which is the failure this test exists to catch,
    // and fake timers cannot help: the transition was scheduled before they
    // would be installed.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 400);
      });
    });

    expect(screen.getByText("4.00 kg")).toBeInTheDocument();
  });

  it("closes the tooltip when the pointer leaves the hovered segment", async () => {
    renderPage();
    const kohl13 = await screen.findByTestId("yield-bar-2026-W13-1");

    fireEvent.mouseEnter(kohl13);
    expect(await screen.findByText("4.00 kg")).toBeInTheDocument();

    fireEvent.mouseLeave(kohl13);

    await waitFor(() => expect(screen.queryByText("4.00 kg")).not.toBeInTheDocument());
  });

  it("moves its menu to another bar on a second right-click", async () => {
    renderPage();
    const kohl13 = await screen.findByTestId("yield-bar-2026-W13-1");
    const kohl14 = screen.getByTestId("yield-bar-2026-W14-1");

    fireEvent.contextMenu(kohl13, { clientX: 10, clientY: 200 });
    expect(await screen.findByRole("menuitem", { name: "Kultur öffnen" })).toBeInTheDocument();

    // Bars are the chart's own right-click targets, so the menu follows the
    // pointer to the next one instead of closing and needing a second click.
    fireEvent.contextMenu(kohl14, { clientX: 80, clientY: 260 });

    expect(await screen.findByRole("menuitem", { name: "Kultur öffnen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Kultur öffnen" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/app/crops?cropId=1");
  });

  it("closes the segment menu when the next right-click lands outside the plot", async () => {
    renderPage();
    const segment = await screen.findByTestId("yield-bar-2026-W13-1");
    // Looked up before the menu opens: MUI's menu is modal and marks the rest
    // of the document aria-hidden, so the legend leaves the accessible tree
    // the moment the menu is up.
    const legendEntry = screen.getByRole("button", { name: "Kohl 5 kg" });

    fireEvent.contextMenu(segment);
    expect(await screen.findByRole("menuitem", { name: "Kultur öffnen" })).toBeInTheDocument();

    // The chart only claims right-clicks on its own bars. Claiming everything
    // would leave a segment's menu standing over an unrelated right-click.
    fireEvent.contextMenu(legendEntry);

    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Kultur öffnen" })).not.toBeInTheDocument(),
    );
  });
});

describe("YieldDistributionChart legend", () => {
  const buildCrops = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      crop_id: index + 1,
      crop_name: `Kultur ${index + 1}`,
      yield: count - index,
      color: "#16a34a",
    }));

  const renderPage = () =>
    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

  it("shows exactly the limit without offering a toggle", async () => {
    mocks.yieldList.mockResolvedValue({
      data: [{ iso_week: "2026-W13", week_start: "2026-03-23", crops: buildCrops(15) }],
    });
    renderPage();
    await screen.findByRole("heading", { name: "Ertragsverteilung" });

    // The boundary: fifteen entries are all of them, so a "show more" button
    // would expand to the same list it is already showing.
    expect(screen.getByText("Kultur 15")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Weitere|Auf Top/ })).not.toBeInTheDocument();
  });

  it("offers the toggle from one crop past the limit", async () => {
    mocks.yieldList.mockResolvedValue({
      data: [{ iso_week: "2026-W13", week_start: "2026-03-23", crops: buildCrops(16) }],
    });
    renderPage();
    await screen.findByRole("heading", { name: "Ertragsverteilung" });

    expect(screen.queryByText("Kultur 16")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Weitere 1 anzeigen" })).toBeInTheDocument();
  });

  it("collapses an expanded legend when the period changes", async () => {
    mocks.yieldList.mockResolvedValue({
      data: [{ iso_week: "2026-W13", week_start: "2026-03-23", crops: buildCrops(17) }],
    });
    renderPage();
    await screen.findByRole("heading", { name: "Ertragsverteilung" });

    fireEvent.click(screen.getByRole("button", { name: "Weitere 2 anzeigen" }));
    expect(await screen.findByText("Kultur 17")).toBeInTheDocument();

    // Switching period rebuilds the chart underneath, so an expansion the
    // user asked for on the old set should not silently carry over.
    fireEvent.click(screen.getByRole("button", { name: "Monat" }));

    await waitFor(() => expect(screen.queryByText("Kultur 17")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Weitere 2 anzeigen" })).toBeInTheDocument();
  });

  it("keeps the highlighted legend entry itself undimmed", async () => {
    mocks.yieldList.mockResolvedValue({
      data: [{
        iso_week: "2026-W13",
        week_start: "2026-03-23",
        crops: [
          { crop_id: 1, crop_name: "Kohl", yield: 5, color: "#16a34a" },
          { crop_id: 2, crop_name: "Karotte", yield: 2, color: "#f97316" },
        ],
      }],
    });
    renderPage();
    const kohl = await screen.findByRole("button", { name: "Kohl 5 kg" });
    const karotte = screen.getByRole("button", { name: "Karotte 2 kg" });

    fireEvent.click(kohl);

    // The one you picked is the one to read; dimming it as well would leave
    // the whole legend faded with nothing standing out.
    expect(kohl).toHaveStyle({ opacity: "1" });
    expect(karotte).toHaveStyle({ opacity: "0.55" });
  });

  it("drops a highlight when its crop is filtered out of the chart", async () => {
    const user = userEvent.setup();
    mocks.yieldList.mockResolvedValue({
      data: [{
        iso_week: "2026-W13",
        week_start: "2026-03-23",
        crops: [
          { crop_id: 1, crop_name: "Kohl", yield: 5, color: "#16a34a" },
          { crop_id: 2, crop_name: "Karotte", yield: 2, color: "#f97316" },
        ],
      }],
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Karotte 2 kg" }));
    expect(screen.getByTestId("yield-bar-2026-W13-1")).toHaveStyle({ opacity: "0.28" });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Kohl" }));

    // The highlighted crop is gone, so nothing is highlighted -- leaving the
    // stale id in place would dim every remaining bar with no way back.
    await waitFor(() =>
      expect(screen.getByTestId("yield-bar-2026-W13-1")).toHaveStyle({ opacity: "1" }),
    );
  });
});

/**
 * The dashed line marking where the axis crosses from one calendar year into
 * the next. Only seasons that deliberately straddle a year (a Sep-Aug season,
 * say) get one -- see `YieldYearBoundaryMarker`.
 */
describe("YieldDistributionChart year-boundary marker", () => {
  const CROSSING_WEEKS = [
    {
      iso_week: "2025-W52",
      week_start: "2025-12-22",
      crops: [{ crop_id: 1, crop_name: "Kohl", yield: 1, color: "#16a34a" }],
    },
    {
      iso_week: "2026-W02",
      week_start: "2026-01-05",
      crops: [{ crop_id: 1, crop_name: "Kohl", yield: 1, color: "#16a34a" }],
    },
  ];

  const renderPage = () =>
    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

  beforeEach(() => {
    outletContext.activeSeason = { start_date: "2025-09-01", end_date: "2026-08-31" };
    mocks.yieldList.mockResolvedValue({ data: CROSSING_WEEKS });
  });

  it("stays away for a calendar-aligned season even when the data crosses a year", async () => {
    // The same crossing data, under a Jan-Dec season. The marker explains a
    // season that spans two years; on a calendar season the crossing is just
    // where the season ends, and a line there would be noise.
    outletContext.activeSeason = { start_date: "2026-01-01", end_date: "2026-12-31" };
    renderPage();

    await screen.findByRole("heading", { name: "Ertragsverteilung" });
    expect(screen.queryByTestId("yield-year-boundary-marker")).not.toBeInTheDocument();
  });

  it("names the two years it separates", async () => {
    renderPage();

    // The line alone says nothing; touch devices have no hover, so the label
    // is what makes it readable at all.
    expect(await screen.findByTestId("yield-year-boundary-marker")).toHaveAccessibleName(
      "Jahreswechsel: 2025 → 2026",
    );
  });

  it("sits on the leading edge of the new year's column, measured inside the plot", async () => {
    renderPage();
    const marker = await screen.findByTestId("yield-year-boundary-marker");

    const plot = screen.getByTestId("yield-chart-plot");
    plot.getBoundingClientRect = () => ({ left: 200, width: 400 }) as DOMRect;
    screen.getByTestId("yield-bar-column-2026-W02").getBoundingClientRect =
      () => ({ left: 340, width: 200 }) as DOMRect;
    fireEvent(window, new Event("resize"));

    // Absolutely positioned inside the plot, so the plot's own offset has to
    // come off the column's viewport coordinate -- 340 - 200, less a pixel to
    // sit in the gap rather than on the bar.
    await waitFor(() => expect(marker).toHaveStyle({ left: "139px" }));
  });

  it("re-measures when the columns are rebuilt", async () => {
    renderPage();
    const marker = await screen.findByTestId("yield-year-boundary-marker");

    const plot = screen.getByTestId("yield-chart-plot");
    plot.getBoundingClientRect = () => ({ left: 0, width: 400 }) as DOMRect;
    screen.getByTestId("yield-bar-column-2026-W02").getBoundingClientRect =
      () => ({ left: 300, width: 100 }) as DOMRect;
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(marker).toHaveStyle({ left: "299px" }));

    // Switching to months replaces every column, and the boundary now falls
    // at a different place. Measuring only once would leave the line pinned
    // to a coordinate from the old axis.
    fireEvent.click(screen.getByRole("button", { name: "Monat" }));
    await waitFor(() => expect(screen.getByTestId("yield-bar-column-2026-01")).toBeInTheDocument());
    screen.getByTestId("yield-bar-column-2026-01").getBoundingClientRect =
      () => ({ left: 140, width: 130 }) as DOMRect;
    fireEvent(window, new Event("resize"));

    await waitFor(() =>
      expect(screen.getByTestId("yield-year-boundary-marker")).toHaveStyle({ left: "139px" }),
    );
  });

  it("disappears when the column it marks is gone", async () => {
    renderPage();
    const marker = await screen.findByTestId("yield-year-boundary-marker");

    screen.getByTestId("yield-bar-column-2026-W02").remove();
    fireEvent(window, new Event("resize"));

    // Without a column to anchor to there is no honest place to draw the
    // line, so it withdraws rather than guessing at zero.
    await waitFor(() => expect(marker).not.toBeInTheDocument());
  });

  it("explains itself on hover", async () => {
    renderPage();
    const marker = await screen.findByTestId("yield-year-boundary-marker");

    fireEvent.mouseEnter(marker);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Jahreswechsel: 2025 → 2026");

    fireEvent.mouseLeave(marker);

    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("pins and unpins its tooltip on tap, where there is no hover", async () => {
    renderPage();
    const marker = await screen.findByTestId("yield-year-boundary-marker");

    fireEvent.click(marker);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Jahreswechsel: 2025 → 2026");

    // A second tap closes it again -- the same hover-or-tap pattern the chart
    // segments use, so a phone is not left with a tooltip it cannot dismiss.
    fireEvent.click(marker);

    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });
});

describe("YieldFilterBar", () => {
  const renderPage = () =>
    render(
      <FocusManagerProvider><MemoryRouter>
        <YieldOverviewPage />
      </MemoryRouter></FocusManagerProvider>,
    );

  beforeEach(() => {
    mocks.yieldList.mockResolvedValue({
      data: [{
        iso_week: "2026-W13",
        week_start: "2026-03-23",
        crops: [
          { crop_id: 1, crop_name: "Kohl", yield: 4, color: "#16a34a" },
          { crop_id: 2, crop_name: "Karotte", yield: 2, color: "#f97316" },
        ],
      }],
    });
  });

  it("narrows the chart to the chosen crop and back", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("yield-bar-2026-W13-2");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Karotte" }));

    await waitFor(() =>
      expect(screen.queryByTestId("yield-bar-2026-W13-1")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("yield-bar-2026-W13-2")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Alle Kulturen" }));

    expect(await screen.findByTestId("yield-bar-2026-W13-1")).toBeInTheDocument();
  });

  it("rescales the y axis to the crop left in view", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("6.0 kg");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Karotte" }));

    // Otherwise a single crop would sit in the bottom third of a chart still
    // scaled to a total it is no longer part of.
    await waitFor(() => expect(screen.getByText("2.0 kg")).toBeInTheDocument());
    expect(screen.queryByText("6.0 kg")).not.toBeInTheDocument();
  });

  it("ignores a click on the already-active period instead of clearing it", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Ertragsverteilung" });

    // MUI reports a deselect as `null`. Passing it straight through would
    // leave the chart with no period at all and no way to pick one back.
    fireEvent.click(screen.getByRole("button", { name: "Woche" }));

    expect(screen.getByRole("button", { name: "Woche" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Monat" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("yield-bar-column-2026-W13")).toBeInTheDocument();
  });
});
