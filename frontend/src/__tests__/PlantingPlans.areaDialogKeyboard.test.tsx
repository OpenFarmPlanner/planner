import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// The real DataGrid.tsx keyboard/edit logic and the real AreaAssignmentDialog,
// with only MUI's <DataGrid> swapped for a mock that renders focusable cells —
// see helpers/muiDataGridKeyboardCellsMock.
vi.mock("@mui/x-data-grid", async () => {
  const { createMuiDataGridKeyboardCellsMock } = await import("./helpers/muiDataGridKeyboardCellsMock");
  return createMuiDataGridKeyboardCellsMock({ renderCellFields: ["bed"] });
});

const DIALOG_NAME = "Anbaufläche ändern";

const bedCell = (planId: number): HTMLElement => screen.getByTestId(`cell-${planId}-bed`);
const cultivationTypeCell = (planId: number): HTMLElement =>
  screen.getByTestId(`cell-${planId}-cultivation_type`);

const queryDialogs = (): HTMLElement[] => screen.queryAllByRole("dialog", { name: DIALOG_NAME });

const findDialog = async (): Promise<HTMLElement> =>
  screen.findByRole("dialog", { name: DIALOG_NAME });

const expectNoDialog = async (): Promise<void> => {
  await waitFor(() => {
    expect(queryDialogs()).toHaveLength(0);
  });
};

const focusCell = async (cell: HTMLElement): Promise<void> => {
  await act(async () => {
    cell.focus();
  });
};

const openFocusedBedDialogWithEnter = async (
  user: ReturnType<typeof userEvent.setup>,
  planId: number,
): Promise<void> => {
  await waitFor(() => {
    expect(within(bedCell(planId)).getByRole("button", { name: "Anbaufläche bearbeiten" })).toHaveFocus();
  });
  await user.keyboard("{Enter}");
};

const renderPlantingPlans = async (): Promise<ReturnType<typeof userEvent.setup>> => {
  const user = userEvent.setup();
  render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
  await waitFor(() => expect(apiMocks.planList).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId("row-10")).toBeInTheDocument());
  return user;
};

describe("PlantingPlans growing-area cell keyboard editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.cropList.mockResolvedValue({ data: { results: [{ id: 5, name: "Salat" }] } });
    apiMocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: "Hof" }] } });
    apiMocks.fieldList.mockResolvedValue({ data: { results: [{ id: 11, name: "Feld 1", location: 1 }] } });
    apiMocks.bedList.mockResolvedValue({
      data: {
        results: [
          { id: 101, name: "Beet 1", field: 11, area_sqm: 10 },
          { id: 102, name: "Beet 2", field: 11, area_sqm: 12 },
        ],
      },
    });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [
          { id: 10, bed: 101, crop: 5, planting_date: "2026-04-01", harvest_date: "2026-05-01", area_usage_sqm: 3 },
          { id: 20, bed: 101, crop: 5, planting_date: "2026-04-02", harvest_date: "2026-05-02", area_usage_sqm: 3 },
        ],
      },
    });
    apiMocks.planUpdate.mockImplementation(async (id: number, data: Record<string, unknown>) => ({
      data: { id, ...data },
    }));
  });

  it("focuses the growing-area cell on Tab and opens the dialog with Enter", async () => {
    const user = await renderPlantingPlans();

    await focusCell(cultivationTypeCell(10));
    await user.tab();

    await expectNoDialog();
    expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-bed");
    await waitFor(() => {
      expect(within(bedCell(10)).getByRole("button", { name: "Anbaufläche bearbeiten" })).toHaveFocus();
    });

    await openFocusedBedDialogWithEnter(user, 10);
    expect(await findDialog()).toBeInTheDocument();
    expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-bed");
  });

  it("reopens the dialog after Cancel when Enter is pressed after returning to the cell", async () => {
    const user = await renderPlantingPlans();

    await focusCell(cultivationTypeCell(10));
    await user.tab();
    await openFocusedBedDialogWithEnter(user, 10);
    await findDialog();

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await expectNoDialog();

    // Focus is back on the cell, so Shift+Tab leaves it the normal way …
    await user.tab({ shift: true });
    await waitFor(() => {
      expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-cultivation_type");
    });
    await expectNoDialog();

    // … and coming back must only focus the cell until Enter starts editing.
    await user.tab();
    await expectNoDialog();
    await openFocusedBedDialogWithEnter(user, 10);
    expect(await findDialog()).toBeInTheDocument();
  });

  it("reopens the dialog with Enter after Apply", async () => {
    const user = await renderPlantingPlans();

    await focusCell(cultivationTypeCell(10));
    await user.tab();
    await openFocusedBedDialogWithEnter(user, 10);
    const dialog = await findDialog();

    await user.click(within(dialog).getByRole("combobox", { name: "Beet" }));
    await user.click(await screen.findByRole("option", { name: /^Beet 2/ }));
    await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));

    await waitFor(() => {
      expect(apiMocks.planUpdate).toHaveBeenCalledWith(10, expect.objectContaining({ bed: 102 }));
    });
    await expectNoDialog();

    await user.tab({ shift: true });
    await waitFor(() => {
      expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-cultivation_type");
    });
    await user.tab();

    await expectNoDialog();
    await openFocusedBedDialogWithEnter(user, 10);
    expect(await findDialog()).toBeInTheDocument();
  });

  it("reopens the dialog with Enter after Escape", async () => {
    const user = await renderPlantingPlans();

    await focusCell(cultivationTypeCell(10));
    await user.tab();
    await openFocusedBedDialogWithEnter(user, 10);
    await findDialog();

    await user.keyboard("{Escape}");
    await expectNoDialog();
    expect(apiMocks.planUpdate).not.toHaveBeenCalled();

    await user.tab({ shift: true });
    await waitFor(() => {
      expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-cultivation_type");
    });
    await user.tab();

    await expectNoDialog();
    await openFocusedBedDialogWithEnter(user, 10);
    expect(await findDialog()).toBeInTheDocument();
  });

  it("opens the dialog only once for a single keyboard edit entry", async () => {
    const user = await renderPlantingPlans();

    const trigger = within(bedCell(10)).getByRole("button", { name: "Anbaufläche bearbeiten" });
    await focusCell(cultivationTypeCell(10));
    await user.tab();
    await openFocusedBedDialogWithEnter(user, 10);
    const dialog = await findDialog();
    expect(queryDialogs()).toHaveLength(1);

    await user.click(within(dialog).getByRole("combobox", { name: "Beet" }));
    await user.click(await screen.findByRole("option", { name: /^Beet 2/ }));

    // The focus, click and edit-request paths can all fire around one entry.
    // A second open would reset the draft the user is already editing.
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(queryDialogs()).toHaveLength(1);
    expect(within(dialog).getByRole("combobox", { name: "Beet" })).toHaveTextContent(/Beet 2/);
  });

  it("keeps focus and tab order intact after Cancel and after Apply", async () => {
    const user = await renderPlantingPlans();

    await focusCell(cultivationTypeCell(10));
    await user.tab();
    await openFocusedBedDialogWithEnter(user, 10);
    await findDialog();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await expectNoDialog();

    await waitFor(() => {
      expect(bedCell(10).contains(document.activeElement)).toBe(true);
    });
    expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-bed");

    // Tab keeps walking the row from the cell the dialog was opened from.
    await user.tab();
    await waitFor(() => {
      expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-sowing_date");
    });

    await focusCell(cultivationTypeCell(10));
    await user.tab();
    await openFocusedBedDialogWithEnter(user, 10);
    const dialog = await findDialog();
    await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    await expectNoDialog();

    await waitFor(() => {
      expect(bedCell(10).contains(document.activeElement)).toBe(true);
    });
    expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-bed");
  });

  it("opens the dialog with Enter for every row and in both navigation directions", async () => {
    const user = await renderPlantingPlans();

    // Second row, forwards.
    await focusCell(cultivationTypeCell(20));
    await user.tab();
    await expectNoDialog();
    await openFocusedBedDialogWithEnter(user, 20);
    await findDialog();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await expectNoDialog();

    // Second row, backwards from the following cell.
    await focusCell(screen.getByTestId("cell-20-sowing_date"));
    await user.tab({ shift: true });
    await expectNoDialog();
    await openFocusedBedDialogWithEnter(user, 20);
    expect(await findDialog()).toBeInTheDocument();
    expect(screen.getByTestId("focused-cell")).toHaveTextContent("20-bed");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await expectNoDialog();

    // First row again — an earlier row's dialog must not consume its request.
    await focusCell(cultivationTypeCell(10));
    await user.tab();
    await expectNoDialog();
    await openFocusedBedDialogWithEnter(user, 10);
    expect(await findDialog()).toBeInTheDocument();
    expect(screen.getByTestId("focused-cell")).toHaveTextContent("10-bed");
  });
});
