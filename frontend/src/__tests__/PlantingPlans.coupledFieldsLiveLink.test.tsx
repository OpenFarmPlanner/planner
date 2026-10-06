/**
 * Coverage for live-carrying a coupled-field pair (Fläche/Pflanzen,
 * Aussaattermin/Pflanztermin) while the row is being edited — see
 * docs/datagrid-architecture.md#coupled-field-pairs. Uses the real MUI
 * DataGrid, like PlantingPlans.areaChange.test.tsx, because the behavior
 * under test lives in the real edit-cell components and the grid's own
 * edit-state wiring, not something a column-definition mock can stand in for.
 */
import { fireEvent, render, waitFor, within } from "@testing-library/react";
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
    cropAPI: { ...actual.cropAPI, list: apiMocks.cropList, listAll: async () => (await apiMocks.cropList()).data },
    locationAPI: { ...actual.locationAPI, list: apiMocks.locationList, listAll: async () => (await apiMocks.locationList()).data },
    fieldAPI: { ...actual.fieldAPI, list: apiMocks.fieldList, listAll: async () => (await apiMocks.fieldList()).data },
    bedAPI: { ...actual.bedAPI, list: apiMocks.bedList, listAll: async () => (await apiMocks.bedList()).data },
    plantingPlanAPI: {
      ...actual.plantingPlanAPI,
      list: apiMocks.planList,
      listAll: async () => (await apiMocks.planList()).data,
      update: apiMocks.planUpdate,
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

describe("PlantingPlans coupled-field live link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [property, value] of GRID_VIEWPORT_SIZE) {
      Object.defineProperty(HTMLElement.prototype, property, {
        configurable: true,
        get: () => value,
      });
    }
    apiMocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: "Hof" }] } });
    apiMocks.fieldList.mockResolvedValue({ data: { results: [{ id: 11, name: "Parzelle 1", location: 1 }] } });
    apiMocks.bedList.mockResolvedValue({
      data: { results: [{ id: 101, name: "Beet A", field: 11, area_sqm: 20 }] },
    });
    apiMocks.planUpdate.mockImplementation(async (
      _id: number,
      data: Record<string, unknown>,
    ) => ({ data: { id: 9, bed: 101, ...data } }));
  });

  describe("Fläche / Pflanzen", () => {
    beforeEach(() => {
      apiMocks.cropList.mockResolvedValue({
        data: { results: [{ id: 2, name: "Möhre", plants_per_m2: 10 }] },
      });
      apiMocks.planList.mockResolvedValue({
        data: {
          results: [{
            id: 9, bed: 101, crop: 2, planting_date: "2026-04-10",
            harvest_date: "2026-05-20", area_usage_sqm: 3,
          }],
        },
      });
    });

    it("recomputes plants count live while typing the area, and highlights it", async () => {
      const user = userEvent.setup();
      await renderPlantingPlans();

      await user.dblClick(cellOf("area_m2")!);
      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy());
      const areaInput = within(cellOf("area_m2")!).getByRole("textbox");
      await user.clear(areaInput);
      await user.type(areaInput, "5");

      await waitFor(() => {
        expect(within(cellOf("plants_count")!).getByRole("textbox")).toHaveValue("50");
      });
      expect(cellOf("plants_count")).toHaveClass("ofp-cell-linked-highlight");
    });

    it("recomputes the area live while typing plants count, and highlights it", async () => {
      const user = userEvent.setup();
      await renderPlantingPlans();

      await user.dblClick(cellOf("plants_count")!);
      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy());
      const plantsInput = within(cellOf("plants_count")!).getByRole("textbox");
      await user.clear(plantsInput);
      await user.type(plantsInput, "2");

      await waitFor(() => {
        expect(within(cellOf("area_m2")!).getByRole("textbox")).toHaveValue("0,2");
      });
      expect(cellOf("area_m2")).toHaveClass("ofp-cell-linked-highlight");
    });

    it("does not touch the partner when the crop has no plant spacing", async () => {
      apiMocks.cropList.mockResolvedValue({
        data: { results: [{ id: 2, name: "Unbekannt" }] },
      });
      const user = userEvent.setup();
      await renderPlantingPlans();

      await user.dblClick(cellOf("area_m2")!);
      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy());
      const areaInput = within(cellOf("area_m2")!).getByRole("textbox");
      await user.clear(areaInput);
      await user.type(areaInput, "5");

      expect(cellOf("plants_count")).not.toHaveClass("ofp-cell-linked-highlight");
    });

    it("saves the field the user actually typed into, not the live-carried partner", async () => {
      const user = userEvent.setup();
      await renderPlantingPlans();

      // Edit plants_count (the driver); this live-carries area_m2 (the
      // follower) via the grid's own setEditCellValue, which also re-runs
      // area_m2's preProcessEditCellProps — exactly the trap that must not
      // steal lastEditedFieldRef from the field the user is actually typing.
      await user.dblClick(cellOf("plants_count")!);
      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy());
      const plantsInput = within(cellOf("plants_count")!).getByRole("textbox");
      await user.clear(plantsInput);
      await user.type(plantsInput, "200");
      await waitFor(() => {
        expect(within(cellOf("area_m2")!).getByRole("textbox")).toHaveValue("20");
      });

      await user.click(document.body);

      await waitFor(() => expect(apiMocks.planUpdate).toHaveBeenCalled());
      expect(apiMocks.planUpdate).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ area_input_unit: "PLANTS", area_input_value: 200 }),
      );
    });

    it("resets both the area and the plants count to their saved values on Escape", async () => {
      const user = userEvent.setup();
      await renderPlantingPlans();
      const originalPlantsText = cellOf("plants_count")?.textContent;

      await user.dblClick(cellOf("area_m2")!);
      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy());
      const areaInput = within(cellOf("area_m2")!).getByRole("textbox");
      await user.clear(areaInput);
      await user.type(areaInput, "5");
      await waitFor(() => {
        expect(within(cellOf("plants_count")!).getByRole("textbox")).toHaveValue("50");
      });

      await user.keyboard("{Escape}");

      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).not.toBeInTheDocument());
      expect(cellOf("area_m2")?.textContent).toContain("3,00");
      expect(cellOf("plants_count")?.textContent).toBe(originalPlantsText);
    });
  });

  describe("Aussaattermin / Pflanztermin (Anzucht)", () => {
    beforeEach(() => {
      apiMocks.cropList.mockResolvedValue({
        data: {
          results: [{
            id: 5, name: "Tomate", plants_per_m2: 5,
            cultivation_types: ["pre_cultivation"], propagation_duration_days: 20,
          }],
        },
      });
      apiMocks.planList.mockResolvedValue({
        data: {
          results: [{
            id: 9, bed: 101, crop: 5, planting_date: "2026-05-01",
            harvest_date: "2026-06-20", area_usage_sqm: 3,
          }],
        },
      });
    });

    it("recomputes the planting date live while typing the sowing date, and highlights it", async () => {
      const user = userEvent.setup();
      await renderPlantingPlans();

      await user.dblClick(cellOf("sowing_date")!);
      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy());
      const sowingInput = within(cellOf("sowing_date")!).getByRole("textbox");
      // A single change event, like DateEditCell.test.tsx's own "direct
      // typing" coverage — the segmented per-character editor's own
      // cursor/selection handling isn't what this test is about.
      fireEvent.change(sowingInput, { target: { value: "01.05.2026" } });

      await waitFor(() => {
        expect(within(cellOf("planting_date")!).getByRole("textbox")).toHaveValue("21.05.2026");
      });
      expect(cellOf("planting_date")).toHaveClass("ofp-cell-linked-highlight");
    });

    it("recomputes the sowing date live while typing the planting date, and highlights it", async () => {
      const user = userEvent.setup();
      await renderPlantingPlans();

      await user.dblClick(cellOf("planting_date")!);
      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy());
      const plantingInput = within(cellOf("planting_date")!).getByRole("textbox");
      fireEvent.change(plantingInput, { target: { value: "20.05.2026" } });

      await waitFor(() => {
        expect(within(cellOf("sowing_date")!).getByRole("textbox")).toHaveValue("30.04.2026");
      });
      expect(cellOf("sowing_date")).toHaveClass("ofp-cell-linked-highlight");
    });

    it("resets both dates to their saved values on Escape", async () => {
      const user = userEvent.setup();
      await renderPlantingPlans();

      await user.dblClick(cellOf("planting_date")!);
      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).toBeTruthy());
      const plantingInput = within(cellOf("planting_date")!).getByRole("textbox");
      fireEvent.change(plantingInput, { target: { value: "20.05.2026" } });
      await waitFor(() => {
        expect(within(cellOf("sowing_date")!).getByRole("textbox")).toHaveValue("30.04.2026");
      });

      await user.keyboard("{Escape}");

      await waitFor(() => expect(document.querySelector(".MuiDataGrid-row--editing")).not.toBeInTheDocument());
      expect(cellOf("planting_date")?.textContent).toBe("1.5.2026");
      expect(cellOf("sowing_date")?.textContent).toBe("11.4.2026");
    });
  });
});
