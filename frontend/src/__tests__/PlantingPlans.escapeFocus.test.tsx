import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Real DataGrid.tsx (the shared edit/cancel/focus-restoration logic), with
// only the underlying MUI <DataGrid> replaced by a lightweight, column-
// agnostic mock — the real PlantingPlans column config (selects, dates,
// etc.) is too heavy to render for real in jsdom.
vi.mock("@mui/x-data-grid", async () => {
  const { createMuiDataGridEscapeFocusMock } = await import("./helpers/muiDataGridEscapeFocusMock");
  return createMuiDataGridEscapeFocusMock();
});

describe("PlantingPlans keyboard focus after cancelling a row edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: "Salat" }] } });
    apiMocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: "Hof" }] } });
    apiMocks.fieldList.mockResolvedValue({ data: { results: [{ id: 11, name: "Feld 1", location: 1 }] } });
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet 1", field: 11, area_sqm: 10 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [{
          id: 10, bed: 101, crop: 5, planting_date: "2026-04-01", harvest_date: "2026-05-01", area_usage_sqm: 3,
        }],
      },
    });
  });

  it("keeps keyboard focus on the grid after entering edit mode and leaving with Escape", async () => {
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);

    await waitFor(() => expect(apiMocks.planList).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("row-10")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Zelle 10-cultivation_type" }));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Zelle 10-cultivation_type" }));
    await waitFor(() => expect(screen.getByTestId("mode-10")).toHaveTextContent("edit"));

    fireEvent.click(screen.getByRole("button", { name: "ESC 10" }));

    await waitFor(() => expect(screen.getByTestId("mode-10")).toHaveTextContent("view"));
    // Escape's default MUI focus-restoration is intentionally suppressed so
    // Escape can cancel instead of just exiting edit mode — DataGrid.tsx
    // must restore focus itself, or it's left stranded outside the grid.
    await waitFor(() => expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-cultivation_type"));
  });
});
