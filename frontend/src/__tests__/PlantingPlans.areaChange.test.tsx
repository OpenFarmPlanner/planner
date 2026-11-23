/**
 * Regression coverage for the inline bed picker on the
 * planting plans page. These tests render the real MUI DataGrid instead of the
 * module mock the other PlantingPlans suites use, because the bug they guard
 * lives in what the picker writes back into the grid's own edit state.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlantingPlans from "../pages/PlantingPlans";

const apiMocks = vi.hoisted(() => ({
  cropList: vi.fn(),
  locationList: vi.fn(),
  fieldList: vi.fn(),
  bedList: vi.fn(),
  planList: vi.fn(),
  planUpdate: vi.fn(),
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
    cropAPI: {
      ...actual.cropAPI,
      list: apiMocks.cropList,
      listAll: async () => (await apiMocks.cropList()).data,
    },
    locationAPI: {
      ...actual.locationAPI,
      list: apiMocks.locationList,
      listAll: async () => (await apiMocks.locationList()).data,
    },
    fieldAPI: {
      ...actual.fieldAPI,
      list: apiMocks.fieldList,
      listAll: async () => (await apiMocks.fieldList()).data,
    },
    bedAPI: {
      ...actual.bedAPI,
      list: apiMocks.bedList,
      listAll: async () => (await apiMocks.bedList()).data,
    },
    plantingPlanAPI: {
      ...actual.plantingPlanAPI,
      list: apiMocks.planList,
      listAll: async () => (await apiMocks.planList()).data,
      update: apiMocks.planUpdate,
      bedSuggestions: vi.fn().mockResolvedValue({ data: { results: [] } }),
    },
  };
});

// jsdom reports every element as 0x0, which leaves the grid's virtualized
// viewport without a single rendered row.
const GRID_VIEWPORT_SIZE: ReadonlyArray<readonly [string, number]> = [
  ["clientWidth", 1400],
  ["clientHeight", 900],
  ["offsetWidth", 1400],
  ["offsetHeight", 900],
];

const cellOf = (field: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.MuiDataGrid-row [data-field="${field}"]`);

const renderPlantingPlans = async (): Promise<void> => {
  render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
  await waitFor(() => expect(apiMocks.planList).toHaveBeenCalled());
  await waitFor(() => expect(cellOf("planting_date")?.textContent).toBeTruthy());
};

const changeGrowingAreaToBedB = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  await user.dblClick(cellOf("bed")!);
  await screen.findByRole("combobox", { name: "Standort, Parzelle, Beet suchen" });
  const option = await screen.findByRole("option", { name: /Beet B/ });
  await waitFor(() => expect(option).not.toHaveAttribute("aria-disabled", "true"));
  await user.click(option);
  await waitFor(() =>
    expect(screen.queryByRole("combobox", { name: "Standort, Parzelle, Beet suchen" })).not.toBeInTheDocument());
};

describe("PlantingPlans growing-area change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [property, value] of GRID_VIEWPORT_SIZE) {
      Object.defineProperty(HTMLElement.prototype, property, {
        configurable: true,
        get: () => value,
      });
    }

    apiMocks.cropList.mockResolvedValue({
      data: { results: [{ id: 2, name: "Salat", plants_per_m2: 10 }] },
    });
    apiMocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: "Hof" }] } });
    apiMocks.fieldList.mockResolvedValue({
      data: { results: [{ id: 11, name: "Parzelle 1", location: 1 }] },
    });
    apiMocks.bedList.mockResolvedValue({
      data: {
        results: [
          { id: 101, name: "Beet A", field: 11, area_sqm: 10 },
          { id: 102, name: "Beet B", field: 11, area_sqm: 12 },
        ],
      },
    });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [{
          id: 9,
          bed: 101,
          crop: 2,
          cultivation_type: "direct_sowing",
          planting_date: "2026-04-10",
          harvest_date: "2026-05-20",
          harvest_end_date: "2026-06-01",
          area_usage_sqm: 3,
        }],
      },
    });
    apiMocks.planUpdate.mockImplementation(async (
      _id: number,
      data: Record<string, unknown>,
    ) => ({
      data: {
        id: 9,
        bed: 102,
        crop: 2,
        cultivation_type: "direct_sowing",
        planting_date: "2026-04-10",
        harvest_date: "2026-05-20",
        harvest_end_date: "2026-06-01",
        area_usage_sqm: 3,
        ...data,
      },
    }));
  });

  it("keeps the row's dates rendered after the growing area of a saved row changed", async () => {
    const user = userEvent.setup();
    await renderPlantingPlans();
    const plantingDateBefore = cellOf("planting_date")?.textContent;

    await changeGrowingAreaToBedB(user);

    await waitFor(() => expect(apiMocks.planUpdate).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ bed: 102 }),
    ));
    await waitFor(() => expect(cellOf("bed")?.textContent).toContain("Beet B"));
    expect(cellOf("planting_date")?.textContent).toBe(plantingDateBefore);
    expect(cellOf("harvest_date")?.textContent).toBe("20.5.2026");
    expect(cellOf("harvest_end_date")?.textContent).toBe("1.6.2026");
  });

  it("keeps the grid alive when the growing area of a row in edit mode changes", async () => {
    const user = userEvent.setup();
    await renderPlantingPlans();

    await user.dblClick(cellOf("crop")!);
    await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy());

    await changeGrowingAreaToBedB(user);

    // Before the fix the area editor wrote the row's raw ISO date strings into the
    // grid's edit state, and MUI's date column threw while rendering the open
    // editor — taking the whole page down through the error boundary.
    expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy();
    expect(within(cellOf("planting_date")!).getByRole("textbox")).toHaveValue("10.04.2026");
    expect(cellOf("bed")?.textContent).toContain("Beet B");
  });
});
