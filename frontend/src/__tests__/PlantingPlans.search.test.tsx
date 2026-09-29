import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlantingPlans from "../pages/PlantingPlans";

const apiMocks = vi.hoisted(() => ({
  cropList: vi.fn(),
  locationList: vi.fn(),
  fieldList: vi.fn(),
  bedList: vi.fn(),
  planList: vi.fn(),
}));

vi.mock("../hooks/useProjectRequirement", () => ({
  useProjectRequirement: () => ({
    shouldShowProjectRequiredState: false,
    missingProjectReason: null,
    activeProjectId: 1,
  }),
}));

vi.mock("../commands/useCommandContext", () => ({
  useCommandContextTag: vi.fn(),
  useRegisterCommands: vi.fn(),
  useRegisterCreateActions: vi.fn(),
}));

vi.mock("../hooks/useNavigationBlocker", () => ({
  useNavigationBlocker: () => ({
    isBlocked: false,
    proceed: vi.fn(),
    reset: vi.fn(),
    destination: null,
  }),
}));

vi.mock("../api/api", async () => {
  const actual = await vi.importActual<typeof import("../api/api")>("../api/api");
  return {
    ...actual,
    cropAPI: { ...actual.cropAPI, list: apiMocks.cropList, listAll: async () => (await apiMocks.cropList()).data },
    locationAPI: { ...actual.locationAPI, list: apiMocks.locationList, listAll: async () => (await apiMocks.locationList()).data },
    fieldAPI: { ...actual.fieldAPI, list: apiMocks.fieldList, listAll: async () => (await apiMocks.fieldList()).data },
    bedAPI: { ...actual.bedAPI, list: apiMocks.bedList, listAll: async () => (await apiMocks.bedList()).data },
    plantingPlanAPI: { ...actual.plantingPlanAPI, list: apiMocks.planList, listAll: async () => (await apiMocks.planList()).data },
  };
});

// The real EditableDataGrid with only MUI's <DataGrid> swapped for a light
// mock that renders one `row-{id}` element per row it is handed — enough to
// see which rows the page-owned search lets through to the grid.
vi.mock("@mui/x-data-grid", async () => {
  const { createMuiDataGridEscapeFocusMock } = await import("./helpers/muiDataGridEscapeFocusMock");
  return createMuiDataGridEscapeFocusMock();
});

const renderPage = async (): Promise<void> => {
  render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("row-10")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId("row-20")).toBeInTheDocument());
};

const typeSearch = (value: string): void => {
  fireEvent.change(screen.getByRole("searchbox", { name: "Anbaupläne durchsuchen" }), { target: { value } });
};

describe("PlantingPlans page search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.cropList.mockResolvedValue({
      data: {
        results: [
          { id: 5, name: "Salat", crop_species_search_names: ["Salat", "Lettuce"] },
          { id: 6, name: "Tomate", variety: "Ruthje", crop_species_search_names: ["Tomate", "Paradeiser"] },
        ],
      },
    });
    apiMocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: "Hofgarten" }, { id: 2, name: "Bachacker" }] } });
    apiMocks.fieldList.mockResolvedValue({
      data: { results: [{ id: 11, name: "Nordfeld", location: 1 }, { id: 21, name: "Ostfeld", location: 2 }] },
    });
    apiMocks.bedList.mockResolvedValue({
      data: {
        results: [
          { id: 101, name: "Beet 1", field: 11, field_name: "Nordfeld", area_sqm: 10 },
          { id: 201, name: "Beet 2", field: 21, field_name: "Ostfeld", area_sqm: 10 },
        ],
      },
    });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 10, bed: 101, crop: 5, cultivation_type: "direct_sowing",
            planting_date: "2026-04-01", harvest_date: "2026-05-01", area_usage_sqm: 3, notes: "",
          },
          {
            id: 20, bed: 201, crop: 6, cultivation_type: "pre_cultivation",
            planting_date: "2026-05-10", harvest_date: "2026-07-01", area_usage_sqm: 3, notes: "Mit **Vlies** abdecken",
          },
        ],
      },
    });
  });

  it("filters the grid rows live, including synonym and notes hits", async () => {
    await renderPage();
    expect(screen.getByTestId("planting-plan-search-count")).toHaveTextContent("2 Anbaupläne");

    typeSearch("PARADEISER");
    await waitFor(() => expect(screen.queryByTestId("row-10")).not.toBeInTheDocument());
    expect(screen.getByTestId("row-20")).toBeInTheDocument();
    expect(screen.getByTestId("planting-plan-search-count")).toHaveTextContent("1 von 2 Anbauplänen");

    typeSearch("vlies ostfeld");
    await waitFor(() => expect(screen.getByTestId("row-20")).toBeInTheDocument());
    expect(screen.queryByTestId("row-10")).not.toBeInTheDocument();

    typeSearch("salat hofgarten");
    await waitFor(() => expect(screen.getByTestId("row-10")).toBeInTheDocument());
    expect(screen.queryByTestId("row-20")).not.toBeInTheDocument();
  });

  it("shows the empty state and clears the search from it", async () => {
    await renderPage();

    typeSearch("zucchini");
    const emptyState = await screen.findByTestId("planting-plan-search-empty");
    expect(within(emptyState).getByRole("heading", { name: "Keine Anbaupläne gefunden für „zucchini“" })).toBeInTheDocument();
    expect(within(emptyState).getByText("Prüfe die Schreibweise oder suche nach Kultur, Sorte oder Beet.")).toBeInTheDocument();
    expect(within(emptyState).queryByRole("button", { name: "Filter zurücksetzen" })).not.toBeInTheDocument();

    fireEvent.click(within(emptyState).getByRole("button", { name: "Suche löschen" }));
    await waitFor(() => expect(screen.queryByTestId("planting-plan-search-empty")).not.toBeInTheDocument());
    expect(screen.getByRole("searchbox", { name: "Anbaupläne durchsuchen" })).toHaveValue("");
    expect(screen.getByTestId("row-10")).toBeInTheDocument();
    expect(screen.getByTestId("row-20")).toBeInTheDocument();
  });

  it("clears the search with Escape", async () => {
    await renderPage();
    typeSearch("salat");
    await waitFor(() => expect(screen.queryByTestId("row-20")).not.toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Anbaupläne durchsuchen" }), { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("row-20")).toBeInTheDocument());
  });

  it("applies filters from the panel immediately and removes them via chips", async () => {
    await renderPage();

    const filterButton = screen.getByRole("button", { name: "Filter" });
    expect(filterButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(filterButton);
    const panel = await screen.findByRole("dialog", { name: "Filter" });
    expect(within(panel).getByText("Tipp: Wähle zuerst einen Standort, dann siehst du nur dessen Parzellen.")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Bachacker" }));
    await waitFor(() => expect(screen.queryByTestId("row-10")).not.toBeInTheDocument());
    expect(within(panel).getByRole("button", { name: "Bachacker" })).toHaveAttribute("aria-pressed", "true");
    // Parzellen narrow to the selected Standort.
    expect(within(panel).queryByRole("button", { name: "Nordfeld" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Ostfeld" })).toBeInTheDocument();
    expect(within(panel).getByText("1 Treffer")).toBeInTheDocument();

    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter" })).not.toBeInTheDocument());

    expect(screen.getByText("Standort: Bachacker")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter Standort entfernen" }));
    await waitFor(() => expect(screen.getByTestId("row-10")).toBeInTheDocument());
    expect(screen.queryByText("Standort: Bachacker")).not.toBeInTheDocument();
  });

  it("hints at the unfiltered hit count when filters hide every search hit", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const panel = await screen.findByRole("dialog", { name: "Filter" });
    fireEvent.click(within(panel).getByRole("button", { name: "Hofgarten" }));
    fireEvent.keyDown(panel, { key: "Escape" });

    typeSearch("tomate");
    const emptyState = await screen.findByTestId("planting-plan-search-empty");
    expect(within(emptyState).getByText("Ohne die aktiven Filter gäbe es 1 Treffer.")).toBeInTheDocument();

    fireEvent.click(within(emptyState).getByRole("button", { name: "Filter zurücksetzen" }));
    await waitFor(() => expect(screen.getByTestId("row-20")).toBeInTheDocument());
    expect(screen.queryByTestId("row-10")).not.toBeInTheDocument();
  });

  it("restores search and filters after a season switch, but only once", async () => {
    window.sessionStorage.setItem("seasonSwitchState:1", JSON.stringify({
      plantingPlanSearch: {
        query: "salat",
        sortKey: "plantingDateAsc",
        filters: {
          locationIds: [1],
          fieldIds: [],
          cultivationTypes: [],
          cropKeys: [],
          plantingMonthFrom: null,
          plantingMonthTo: null,
        },
      },
    }));

    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("row-10")).toBeInTheDocument());
    expect(screen.queryByTestId("row-20")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Anbaupläne durchsuchen" })).toHaveValue("salat");
    expect(screen.getByText("Standort: Hofgarten")).toBeInTheDocument();
    await waitFor(() => expect(window.sessionStorage.getItem("seasonSwitchState:1")).toBeNull());
  });
});
