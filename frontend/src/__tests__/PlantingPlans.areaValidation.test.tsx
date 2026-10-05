import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import PlantingPlans from "../pages/PlantingPlans";
import type { EditableDataGridCommandApi } from "../components/data-grid";
import { registerOpenContextMenu } from "../components/contextMenu/contextMenuOpenState";

const mockGridRowState = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
}));

const apiMocks = vi.hoisted(() => ({
  cropList: vi.fn(),
  locationList: vi.fn(),
  fieldList: vi.fn(),
  bedList: vi.fn(),
  planList: vi.fn(),
}));

const commandApiSpies = vi.hoisted(() => ({
  addRow: vi.fn(),
  setDraftValues: vi.fn(),
  commitDraftValues: vi.fn(),
  applyDialogEditValues: vi.fn(),
  saveAttemptResult: vi.fn(),
  apiPayload: vi.fn(),
  gridProps: vi.fn(),
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

vi.mock("../components/data-grid", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const actual = await vi.importActual<typeof import("../components/data-grid")>("../components/data-grid");
  type MockGridProps = {
    api?: {
      list?: () => Promise<{ data: { results: Record<string, unknown>[] } }>;
    };
    mapToRow?: (row: Record<string, unknown>) => Record<string, unknown>;
    mapToApiData?: (row: Record<string, unknown>) => Partial<Record<string, unknown>> | Promise<Partial<Record<string, unknown>>>;
    onRowsStateChange?: (rows: Record<string, unknown>[]) => void;
    onLoadStateChange?: (state: { loading: boolean; dataFetched: boolean }) => void;
    onBeforeSaveRow?: (row: Record<string, unknown>) => boolean | Record<string, unknown> | Promise<boolean | Record<string, unknown>>;
    commandApiRef?: { current: EditableDataGridCommandApi | null };
    showDeleteAction?: boolean;
    showRowEditActions?: boolean;
    getRowActions?: (
      row: Record<string, unknown>,
      helpers: {
        duplicate: (row: Record<string, unknown>) => void;
        delete: (rowId: string | number) => void;
      },
    ) => Array<{
      id: string;
      label: string;
      color?: string;
      onClick: (
        row: Record<string, unknown>,
        helpers: {
          duplicate: (row: Record<string, unknown>) => void;
          delete: (rowId: string | number) => void;
        },
      ) => void;
    }>;
    duplicateRow?: (row: Record<string, unknown>) => Record<string, unknown>;
    getInlineRowActions?: (
      row: Record<string, unknown>,
      helpers: {
        delete: (rowId: string | number) => void;
      },
    ) => Array<{
      id: string;
      label: string;
      color?: string;
      onClick: (
        row: Record<string, unknown>,
        helpers: {
          delete: (rowId: string | number) => void;
        },
      ) => void;
    }>;
    inlineRowActionField?: string;
    deleteUndoOptions?: { message: string; snackbarTestId?: string };
  };
  return {
    ...actual,
    EditableDataGrid: (props: MockGridProps) => {
      const { api, mapToRow, mapToApiData, onRowsStateChange, onLoadStateChange, onBeforeSaveRow, commandApiRef } = props;
      commandApiSpies.gridProps(props);
      if (commandApiRef) {
        commandApiRef.current = {
          addRow: commandApiSpies.addRow,
          editSelectedRow: vi.fn(),
          deleteSelectedRow: vi.fn(),
          getSelectedRowId: vi.fn(),
          reload: vi.fn(),
          setDraftValues: commandApiSpies.setDraftValues,
          commitDraftValues: async (rowId, values) => {
            commandApiSpies.commitDraftValues(rowId, values);
            const nextRow = { ...mockGridRowState.row, ...values };
            mockGridRowState.row = nextRow;
            await Promise.resolve(mapToApiData?.(nextRow)).then((payload) => {
              commandApiSpies.apiPayload(payload);
            });
            commandApiSpies.saveAttemptResult(true);
          },
          applyDialogEditValues: commandApiSpies.applyDialogEditValues,
        };
      }
      const latestPropsRef = React.useRef({ api, mapToRow, onRowsStateChange, onLoadStateChange });
      latestPropsRef.current = { api, mapToRow, onRowsStateChange, onLoadStateChange };
      React.useEffect(() => {
        let isMounted = true;
        const { api: currentApi, mapToRow: currentMapToRow, onRowsStateChange: currentOnRowsStateChange, onLoadStateChange: currentOnLoadStateChange } = latestPropsRef.current;
        currentOnLoadStateChange?.({ loading: true, dataFetched: false });
        void currentApi?.list?.().then((response) => {
          if (!isMounted) {
            return;
          }
          const rows = response.data.results.map((row) => currentMapToRow?.(row) ?? row);
          currentOnRowsStateChange?.(rows);
          currentOnLoadStateChange?.({ loading: false, dataFetched: true });
        });
        return () => {
          isMounted = false;
        };
      }, []);
      const handleSaveAttempt = async (): Promise<void> => {
        const result = await (onBeforeSaveRow?.(mockGridRowState.row) ?? true);
        if (result !== true && result !== false) {
          commandApiSpies.setDraftValues(mockGridRowState.row.id, result);
          commandApiSpies.saveAttemptResult(true);
          void Promise.resolve(mapToApiData?.({ ...mockGridRowState.row, ...result })).then((payload) => {
            commandApiSpies.apiPayload(payload);
          });
          return;
        }
        commandApiSpies.saveAttemptResult(result);
        if (result) {
          void Promise.resolve(mapToApiData?.(mockGridRowState.row)).then((payload) => {
            commandApiSpies.apiPayload(payload);
          });
        }
      };
      return (
        <>
          <button
            type="button"
            onClick={() => void handleSaveAttempt()}
          >
            Zeile speichern
          </button>
          <button
            type="button"
            onClick={() => void handleSaveAttempt()}
          >
            Speichern mit Enter
          </button>
          <button
            type="button"
            onClick={() => void handleSaveAttempt()}
          >
            Speichern durch Fokusverlust
          </button>
        </>
      );
    },
  };
});

const areaText = (label: string, value: string): RegExp =>
  new RegExp(`${label}:\\s*${value}\\s*m²`);

const waitForPlansToLoad = async (callCount = 1): Promise<void> => {
  await waitFor(() => {
    expect(apiMocks.planList).toHaveBeenCalledTimes(callCount);
  });
};

const mockRemainingAreaScenario = (): void => {
  apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet A", field: 11, area_sqm: 7 }] } });
  apiMocks.planList.mockResolvedValue({
    data: {
      results: [{
        id: 9, bed: 101, crop: 2, planting_date: "2026-04-01", harvest_date: "2026-05-01", area_usage_sqm: 3,
      }],
    },
  });
};

const expectMaxAreaApplied = async (): Promise<void> => {
  expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(true);
  expect(commandApiSpies.setDraftValues).toHaveBeenCalledWith(1, expect.objectContaining({ area_m2: 4, plants_count: 40 }));
  await waitFor(() => {
    expect(commandApiSpies.apiPayload).toHaveBeenCalledWith(expect.objectContaining({ area_input_value: 4, area_input_unit: "M2" }));
  });
  expect(screen.queryByText("Der Wert muss größer als 0 sein.")).not.toBeInTheDocument();
  expect(await screen.findByText(areaText("Maximal verfügbare Fläche übernommen", "4,00"))).toBeInTheDocument();
};

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
    },
  };
});

describe("PlantingPlans save-time area validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGridRowState.row = {};
    apiMocks.cropList.mockResolvedValue({ data: { results: [{ id: 2, name: "Möhre", plants_per_m2: 10 }] } });
    apiMocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: "Hof" }] } });
    apiMocks.fieldList.mockResolvedValue({ data: { results: [{ id: 11, name: "Parzelle 1", location: 1 }] } });
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet A", field: 11, area_sqm: 1 }] } });
    apiMocks.planList.mockResolvedValue({ data: { results: [] } });
  });

  it("uses contextual row actions instead of permanent action columns", async () => {
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
    expect(latestProps).toMatchObject({
      showDeleteAction: false,
      showRowEditActions: false,
      inlineRowActionField: "crop",
      deleteUndoOptions: {
        message: "Anbauplan gelöscht",
        snackbarTestId: "planting-plan-delete-snackbar",
      },
    });
    expect(latestProps.duplicateRow).toBeTypeOf("function");
    expect(latestProps.getRowActions).toBeTypeOf("function");
    const duplicateHelper = vi.fn();
    const deleteHelper = vi.fn();
    const rowActions = latestProps.getRowActions({ id: 9 }, {
      duplicate: duplicateHelper,
      delete: deleteHelper,
    });
    expect(rowActions.map((action: { id: string }) => action.id)).toEqual([
      "create-planting-plan",
      "duplicate",
      "delete",
    ]);
    expect(rowActions[0]).toMatchObject({
      label: "Anbauplan erstellen",
      color: "primary",
    });
    rowActions[0].onClick({ id: 9 }, {
      duplicate: duplicateHelper,
      delete: deleteHelper,
    });
    expect(commandApiSpies.addRow).toHaveBeenCalledTimes(1);
    expect(latestProps.duplicateRow({
      id: 9,
      bed: 101,
      crop: 2,
      planting_date: "2026-04-01",
      area_m2: 3,
      notes: "Notiz",
    })).toMatchObject({
      bed: 101,
      crop: 2,
      planting_date: "2026-04-01",
      area_m2: 3,
      notes: "Notiz",
      isNew: true,
      __draft: true,
      note_attachment_count: 0,
    });
    const inlineDeleteHelper = vi.fn();
    const inlineRowActions = latestProps.getInlineRowActions({
      id: -1,
      crop: 0,
      bed: 101,
      area_m2: 5,
      isNew: true,
      __draft: true,
    }, {
      delete: inlineDeleteHelper,
    });
    expect(inlineRowActions.map((action: { id: string }) => action.id)).toEqual(["delete"]);
    inlineRowActions[0].onClick({ id: -1, bed: 101 }, { delete: inlineDeleteHelper });
    expect(inlineDeleteHelper).toHaveBeenCalledWith(-1);
  });

  it("edits the growing area through its dialog instead of an inline edit cell", async () => {
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
    const bedColumn = (latestProps?.columns ?? []).find(
      (column: { field: string }) => column.field === "bed",
    );

    expect(latestProps?.dialogEditFields).toContain("bed");
    expect(bedColumn?.editable).toBe(false);
    expect(bedColumn?.renderEditCell).toBeUndefined();
    expect(bedColumn?.valueSetter).toBeUndefined();
  });

  it("opens the growing area dialog with a single click and saves the picked bed", async () => {
    apiMocks.bedList.mockResolvedValue({
      data: {
        results: [
          { id: 101, name: "Beet A", field: 11, area_sqm: 1 },
          { id: 102, name: "Beet B", field: 11, area_sqm: 3 },
        ],
      },
    });
    const user = userEvent.setup();
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
    const bedColumn = (latestProps?.columns ?? []).find(
      (column: { field: string }) => column.field === "bed",
    );
    const cell = render(
      <>
        {bedColumn.renderCell({
          id: 7,
          field: "bed",
          value: 101,
          row: { id: 7, bed: 101, area_m2: 1 },
          hasFocus: false,
        })}
      </>,
    );

    await user.click(cell.getByRole("button", { name: "Anbaufläche bearbeiten" }));
    await user.click(await screen.findByRole("combobox", { name: "Beet" }));
    await user.click(await screen.findByRole("option", { name: /^Beet B/ }));
    await user.click(screen.getByRole("button", { name: "Übernehmen" }));

    await waitFor(() => {
      expect(commandApiSpies.applyDialogEditValues).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ bed: 102 }),
      );
    });
    expect(commandApiSpies.setDraftValues).not.toHaveBeenCalled();
    cell.unmount();
  });

  it("does not open the growing area dialog while an app context menu is open", async () => {
    apiMocks.bedList.mockResolvedValue({
      data: {
        results: [
          { id: 101, name: "Beet A", field: 11, area_sqm: 1 },
          { id: 102, name: "Beet B", field: 11, area_sqm: 3 },
        ],
      },
    });
    const user = userEvent.setup();
    const releaseMenu = registerOpenContextMenu(Symbol("test-context-menu"));

    try {
      render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
      await waitForPlansToLoad();

      const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
      const bedColumn = (latestProps?.columns ?? []).find(
        (column: { field: string }) => column.field === "bed",
      );
      const cell = render(
        <>
          {bedColumn.renderCell({
            id: 7,
            field: "bed",
            value: 101,
            row: { id: 7, bed: 101, area_m2: 1 },
            hasFocus: false,
          })}
        </>,
      );

      await user.click(cell.getByRole("button", { name: "Anbaufläche bearbeiten" }));

      expect(screen.queryByRole("dialog", { name: "Anbaufläche ändern" })).not.toBeInTheDocument();
      cell.unmount();
    } finally {
      releaseMenu();
    }
  });

  it("uses one compact width for all date columns", async () => {
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
    const columns = latestProps?.columns ?? [];
    const dateColumns = ["planting_date", "harvest_date", "harvest_end_date"].map((field) =>
      columns.find((column: { field: string }) => column.field === field),
    );

    expect(dateColumns).toEqual([
      expect.objectContaining({ minWidth: 142, width: 142, maxWidth: 142 }),
      expect.objectContaining({ minWidth: 142, width: 142, maxWidth: 142 }),
      expect.objectContaining({ minWidth: 142, width: 142, maxWidth: 142 }),
    ]);
    // The planting-date column has a season-constrained custom edit cell; the
    // (read-only calculated) harvest columns keep the default rendering.
    const [plantingDateColumn, ...harvestColumns] = dateColumns;
    expect(typeof plantingDateColumn?.renderEditCell).toBe("function");
    expect(harvestColumns.every((column) => column?.renderEditCell === undefined)).toBe(true);
  });

  it("explains the harvest start and end calculations separately", async () => {
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
    const columns = latestProps?.columns ?? [];
    const harvestStartColumn = columns.find((column: { field: string }) => column.field === "harvest_date");
    const harvestEndColumn = columns.find((column: { field: string }) => column.field === "harvest_end_date");

    const startHeader = render(<>{harvestStartColumn.renderHeader()}</>);
    await userEvent.hover(startHeader.getByText("Erntebeginn"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Wird automatisch aus Pflanztermin und Wachstumszeit der Kultur berechnet.",
    );
    startHeader.unmount();

    const endHeader = render(<>{harvestEndColumn.renderHeader()}</>);
    await userEvent.hover(endHeader.getByText("Ernteende"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Wird automatisch aus Erntebeginn und Erntezeit der Kultur berechnet.",
    );
    endHeader.unmount();
  });

  it("couples the sowing date column with the planting date", async () => {
    apiMocks.cropList.mockResolvedValue({
      data: {
        results: [
          { id: 2, name: "Möhre", plants_per_m2: 10, cultivation_types: ["direct_sowing"] },
          { id: 5, name: "Tomate", plants_per_m2: 5, cultivation_types: ["pre_cultivation"], propagation_duration_days: 20 },
        ],
      },
    });
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
    const columns = latestProps?.columns ?? [];
    const sowingDateColumn = columns.find((column: { field: string }) => column.field === "sowing_date");
    const plantingDateColumn = columns.find((column: { field: string }) => column.field === "planting_date");

    expect(sowingDateColumn).toBeDefined();
    expect(plantingDateColumn.headerClassName).toBe("coupled-field-header");
    expect(sowingDateColumn.headerClassName).toBe("coupled-field-header");

    // Direct sowing: sowing date equals planting date, and is fully editable.
    const directRow = { id: 1, crop: 2, planting_date: "2026-05-01" };
    expect(sowingDateColumn.valueGetter(undefined, directRow)).toEqual(new Date("2026-05-01"));
    expect(sowingDateColumn.isCellEditable({ row: directRow })).toBe(true);
    expect(sowingDateColumn.valueSetter(new Date("2026-04-20"), directRow)).toEqual(
      expect.objectContaining({ planting_date: "2026-04-20" }),
    );

    // Anzucht: sowing date is planting date minus the propagation duration,
    // and editing it shifts the planting date forward by that duration.
    const anzuchtRow = { id: 2, crop: 5, planting_date: "2026-05-01" };
    expect(sowingDateColumn.valueGetter(undefined, anzuchtRow)).toEqual(new Date("2026-04-11"));
    expect(sowingDateColumn.isCellEditable({ row: anzuchtRow })).toBe(true);
    expect(sowingDateColumn.valueSetter(new Date("2026-04-11"), anzuchtRow)).toEqual(
      expect.objectContaining({ planting_date: "2026-05-01" }),
    );
  });

  it("marks the sowing date cell non-editable with a dash and tooltip when the crop has no propagation duration", async () => {
    apiMocks.cropList.mockResolvedValue({
      data: {
        results: [
          { id: 6, name: "Unbekannt", plants_per_m2: 5, cultivation_types: ["pre_cultivation"] },
        ],
      },
    });
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
    const columns = latestProps?.columns ?? [];
    const sowingDateColumn = columns.find((column: { field: string }) => column.field === "sowing_date");

    const row = { id: 3, crop: 6, planting_date: "2026-05-01" };
    expect(sowingDateColumn.isCellEditable({ row })).toBe(false);
    expect(sowingDateColumn.cellClassName({ row })).toContain("ofp-cell-full-tooltip");

    const missingCell = render(<>{sowingDateColumn.renderCell({ row, hasFocus: false })}</>);
    const missingDash = missingCell.getByText("—");
    expect(missingDash).toBeInTheDocument();
    const trigger = missingCell.container.querySelector(".ofp-full-cell-tooltip-trigger");
    expect(trigger).not.toBeNull();
    await userEvent.hover(trigger as Element);
    expect(await screen.findByText("Nicht berechenbar, da für diese Kultur keine Anzuchtdauer hinterlegt ist.")).toBeInTheDocument();
    missingCell.unmount();
  });

  it("renders unavailable calculated harvest dates with a dash and explanatory tooltip", async () => {
    apiMocks.cropList.mockResolvedValue({
      data: {
        results: [
          { id: 2, name: "Ohne Zeitangaben", plants_per_m2: 10, growth_duration_days: null, harvest_duration_days: null },
          { id: 3, name: "Nur Wachstumszeit", plants_per_m2: 10, growth_duration_days: 30, harvest_duration_days: null },
          { id: 4, name: "Vollständige Zeitangaben", plants_per_m2: 10, growth_duration_days: 30, harvest_duration_days: 7 },
        ],
      },
    });
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
    const columns = latestProps?.columns ?? [];
    const harvestStartColumn = columns.find((column: { field: string }) => column.field === "harvest_date");
    const harvestEndColumn = columns.find((column: { field: string }) => column.field === "harvest_end_date");
    const renderCell = (column: { renderCell?: (params: unknown) => ReactNode }, row: Record<string, unknown>) => (
      column.renderCell?.({
        field: column === harvestEndColumn ? "harvest_end_date" : "harvest_date",
        row,
      })
    );

    expect(harvestStartColumn.cellClassName({ value: null })).toContain("ofp-cell-full-tooltip");
    expect(harvestStartColumn.cellClassName({ value: new Date("2026-05-01") })).not.toContain("ofp-cell-full-tooltip");

    const completeStart = render(<>{renderCell(harvestStartColumn, {
      id: 1,
      crop: 4,
      harvest_date: "2026-05-01",
      harvest_end_date: "2026-05-08",
    })}</>);
    expect(completeStart.getByText("1.5.2026")).toBeInTheDocument();
    completeStart.unmount();

    const missingStart = render(<>{renderCell(harvestStartColumn, {
      id: 2,
      crop: 2,
      harvest_date: null,
      harvest_end_date: null,
    })}</>);
    const missingDash = missingStart.getByText("—");
    expect(missingDash).toBeInTheDocument();
    const missingCellTrigger = missingStart.container.querySelector(".ofp-full-cell-tooltip-trigger");
    expect(missingCellTrigger).not.toBeNull();
    await userEvent.hover(missingCellTrigger as Element);
    expect(await screen.findByText("Nicht berechenbar, da für diese Kultur keine Wachstumszeit hinterlegt ist.")).toBeInTheDocument();
    missingStart.unmount();

    const missingEnd = render(<>{renderCell(harvestEndColumn, {
      id: 3,
      crop: 2,
      harvest_date: null,
      harvest_end_date: null,
    })}</>);
    const missingEndDash = missingEnd.getByText("—");
    expect(missingEndDash).toBeInTheDocument();
    await userEvent.hover(missingEndDash);
    expect(await screen.findByText("Nicht berechenbar, da für diese Kultur weder eine Wachstumszeit noch eine Erntezeit hinterlegt ist.")).toBeInTheDocument();
    missingEnd.unmount();

    const partialEnd = render(<>{renderCell(harvestEndColumn, {
      id: 4,
      crop: 3,
      harvest_date: "2026-05-01",
      harvest_end_date: null,
    })}</>);
    const partialDash = partialEnd.getByText("—");
    expect(partialDash).toBeInTheDocument();
    await userEvent.hover(partialDash);
    expect(await screen.findByText("Nicht berechenbar, da für diese Kultur keine Erntezeit hinterlegt ist.")).toBeInTheDocument();
    partialEnd.unmount();
  });

  it("shows bed-limit dialog when requested area exceeds bed area", async () => {
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-01", area_m2: "99,00",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    expect(await screen.findByText("Die angegebene Fläche überschreitet die Größe dieses Beets.")).toBeInTheDocument();
    expect(screen.getByText(areaText("Beetfläche", "1,00"))).toBeInTheDocument();
    expect(screen.getByText(areaText("Angefragt", "99,00"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beetfläche übernehmen" })).toBeInTheDocument();
  });

  it("shows bed-limit dialog when plants count implies an area larger than the bed", async () => {
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-01", area_m2: "0,50", plants_count: "1000",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0] as {
      columns: Array<{
        field: string;
        preProcessEditCellProps?: (params: { hasChanged: boolean; props: Record<string, unknown> }) => unknown;
      }>;
    };
    latestProps.columns
      .find((column) => column.field === "plants_count")
      ?.preProcessEditCellProps?.({ hasChanged: true, props: {} });

    await userEvent.click(await screen.findByRole("button", { name: "Speichern mit Enter" }));

    expect(await screen.findByText("Die angegebene Fläche überschreitet die Größe dieses Beets.")).toBeInTheDocument();
    expect(screen.getByText(areaText("Beetfläche", "1,00"))).toBeInTheDocument();
    expect(screen.getByText(areaText("Angefragt", "100,00"))).toBeInTheDocument();
    expect(commandApiSpies.apiPayload).not.toHaveBeenCalled();
  });

  it("closes the area validation dialog with Escape", async () => {
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-01", area_m2: "99",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Die angegebene Fläche überschreitet die Größe dieses Beets.",
    });
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", {
        name: "Die angegebene Fläche überschreitet die Größe dieses Beets.",
      })).not.toBeInTheDocument();
    });
    expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(false);
  });

  it("shows bed-limit dialog when saving via Enter flow", async () => {
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-01", area_m2: "99",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Speichern mit Enter" }));

    expect(await screen.findByText("Die angegebene Fläche überschreitet die Größe dieses Beets.")).toBeInTheDocument();
  });

  it("shows bed-limit dialog when saving through focus loss", async () => {
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-01", area_m2: "99",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Speichern durch Fokusverlust" }));

    expect(await screen.findByText("Die angegebene Fläche überschreitet die Größe dieses Beets.")).toBeInTheDocument();
    expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(false);
    expect(commandApiSpies.apiPayload).not.toHaveBeenCalled();
  });

  it("keeps invalid drafts editable when the conflict dialog is canceled", async () => {
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-01", area_m2: "99",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));
    await userEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));

    await waitFor(() => {
      expect(screen.queryByText("Die angegebene Fläche überschreitet die Größe dieses Beets.")).not.toBeInTheDocument();
    });
    expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(false);
    expect(commandApiSpies.setDraftValues).not.toHaveBeenCalled();
    expect(commandApiSpies.apiPayload).not.toHaveBeenCalled();
    expect(mockGridRowState.row).toMatchObject({ area_m2: "99" });
  });

  it("does not start another area validation while closing a canceled conflict dialog", async () => {
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet A", field: 11, area_sqm: 4 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [{
          id: 9, bed: 101, crop: 2, planting_date: "2026-04-01", harvest_date: "2026-05-01", area_usage_sqm: 4,
        }],
      },
    });
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-10", harvest_date: "2026-05-10", area_m2: "2",
    };

    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    const focusLossSaveButton = await screen.findByRole("button", { name: "Speichern durch Fokusverlust" });
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));
    fireEvent.click(focusLossSaveButton);

    await waitFor(() => {
      expect(screen.queryByText("Für dieses Beet ist im gewählten Zeitraum keine freie Fläche verfügbar.")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Die angegebene Fläche überschreitet die verfügbare Restfläche dieses Beets.")).not.toBeInTheDocument();
    expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(false);
    expect(commandApiSpies.apiPayload).not.toHaveBeenCalled();
  });

  it("applies bed area when clicking 'Beetfläche übernehmen'", async () => {
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-01", area_m2: "99,00",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));
    await userEvent.click(await screen.findByRole("button", { name: "Beetfläche übernehmen" }));

    expect(commandApiSpies.commitDraftValues).toHaveBeenCalledWith(1, expect.objectContaining({ area_m2: 1, plants_count: 10 }));
    expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(true);
    await waitFor(() => {
      expect(screen.queryByText("Die angegebene Fläche überschreitet die Größe dieses Beets.")).not.toBeInTheDocument();
    });
  });

  it("shows remaining-area dialog when request exceeds available area", async () => {
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet A", field: 11, area_sqm: 7 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [{
          id: 9, bed: 101, crop: 2, planting_date: "2026-04-01", harvest_date: "2026-05-01", area_usage_sqm: 4,
        }],
      },
    });
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-10", harvest_date: "2026-05-10", area_m2: "5",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    expect(await screen.findByText("Die angegebene Fläche überschreitet die verfügbare Restfläche dieses Beets.")).toBeInTheDocument();
    expect(screen.getByText(areaText("Verfügbare Restfläche", "3,00"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restfläche übernehmen" })).toBeInTheDocument();
  });

  it("commits remaining area when clicking 'Restfläche übernehmen'", async () => {
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet A", field: 11, area_sqm: 7 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [{
          id: 9, bed: 101, crop: 2, planting_date: "2026-04-01", harvest_date: "2026-05-01", area_usage_sqm: 4,
        }],
      },
    });
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-10", harvest_date: "2026-05-10", area_m2: "5",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));
    await userEvent.click(await screen.findByRole("button", { name: "Restfläche übernehmen" }));

    expect(commandApiSpies.commitDraftValues).toHaveBeenCalledWith(1, expect.objectContaining({ area_m2: 3, plants_count: 30 }));
    expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(true);
    await waitFor(() => {
      expect(screen.queryByText("Die angegebene Fläche überschreitet die verfügbare Restfläche dieses Beets.")).not.toBeInTheDocument();
    });
  });

  it("shows remaining-area dialog when saving via Enter flow", async () => {
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet A", field: 11, area_sqm: 7 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [{
          id: 9, bed: 101, crop: 2, planting_date: "2026-04-01", harvest_date: "2026-05-01", area_usage_sqm: 4,
        }],
      },
    });
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-10", harvest_date: "2026-05-10", area_m2: "5",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Speichern mit Enter" }));

    expect(await screen.findByText("Die angegebene Fläche überschreitet die verfügbare Restfläche dieses Beets.")).toBeInTheDocument();
  });

  it("shows identical dialog details for click-save and enter-save", async () => {
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-01", area_m2: "99,00",
    };
    const { unmount } = render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));
    expect(await screen.findByText(areaText("Übernommen wird", "1,00"))).toBeInTheDocument();
    unmount();

    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad(2);
    await userEvent.click(await screen.findByRole("button", { name: "Speichern mit Enter" }));
    expect(await screen.findByText(areaText("Übernommen wird", "1,00"))).toBeInTheDocument();
  });

  it("applies available area and shows snackbar for empty or max input", async () => {
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet A", field: 11, area_sqm: 7 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [{
          id: 9, bed: 101, crop: 2, planting_date: "2026-04-01", harvest_date: "2026-05-01", area_usage_sqm: 4,
        }],
      },
    });
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-10", harvest_date: "2026-05-10", area_m2: "max",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    expect(commandApiSpies.setDraftValues).toHaveBeenCalledWith(1, expect.objectContaining({ area_m2: 3, plants_count: 30 }));
    expect(await screen.findByText(areaText("Maximal verfügbare Fläche übernommen", "3,00"))).toBeInTheDocument();
    expect(screen.queryByText("Die angegebene Fläche überschreitet die verfügbare Restfläche dieses Beets.")).not.toBeInTheDocument();
  });

  it("applies the remaining area for max input without positive-number validation", async () => {
    mockRemainingAreaScenario();
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-10", harvest_date: "2026-05-10", area_m2: "max",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    await expectMaxAreaApplied();
  });

  it("applies the remaining area for trimmed uppercase max input", async () => {
    mockRemainingAreaScenario();
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-10", harvest_date: "2026-05-10", area_m2: " MAX ",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    await expectMaxAreaApplied();
  });

  it("applies the remaining area for empty area input", async () => {
    mockRemainingAreaScenario();
    mockGridRowState.row = {
      id: 1, bed: 101, crop: 2, planting_date: "2026-04-10", harvest_date: "2026-05-10", area_m2: "",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    await expectMaxAreaApplied();
  });

  it("sends the auto-filled remaining area when the row model still contains an empty area", async () => {
    mockRemainingAreaScenario();
    const staleRow = {
      id: 1,
      bed: 101,
      crop: 2,
      cultivation_type: "direct_sowing",
      planting_date: "2026-04-10",
      harvest_date: "2026-05-10",
      area_m2: "",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();

    const latestProps = commandApiSpies.gridProps.mock.calls.at(-1)?.[0];
    expect(latestProps?.mapToApiData).toBeDefined();
    const payload = await latestProps?.mapToApiData?.(staleRow);

    expect(payload).toEqual(expect.objectContaining({
      area_input_value: 4,
      area_input_unit: "M2",
    }));
  });

  it("does not count same-bed rows whose German date ranges do not overlap", async () => {
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet 1", field: 11, area_sqm: 7 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 21,
            bed: 101,
            crop: 2,
            planting_date: "20.9.2026",
            harvest_end_date: "2.2.2027",
            area_usage_sqm: 7,
          },
          {
            id: 22,
            bed: 101,
            crop: 2,
            planting_date: "20.2.2026",
            harvest_end_date: "18.9.2026",
            area_usage_sqm: 1,
          },
        ],
      },
    });
    mockGridRowState.row = {
      id: 22,
      bed: 101,
      crop: 2,
      planting_date: "20.2.2026",
      harvest_end_date: "18.9.2026",
      area_m2: "7",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText("Für dieses Beet ist im gewählten Zeitraum keine freie Fläche verfügbar.")).not.toBeInTheDocument();
  });

  it("counts same-bed rows whose German date ranges overlap", async () => {
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "Beet 1", field: 11, area_sqm: 7 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 23,
            bed: 101,
            crop: 2,
            planting_date: "2.2.2026",
            harvest_end_date: "2.6.2026",
            area_usage_sqm: 3,
          },
          {
            id: 22,
            bed: 101,
            crop: 2,
            planting_date: "20.2.2026",
            harvest_end_date: "18.9.2026",
            area_usage_sqm: 1,
          },
        ],
      },
    });
    mockGridRowState.row = {
      id: 22,
      bed: 101,
      crop: 2,
      planting_date: "20.2.2026",
      harvest_end_date: "18.9.2026",
      area_m2: "5",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    expect(await screen.findByText("Die angegebene Fläche überschreitet die verfügbare Restfläche dieses Beets.")).toBeInTheDocument();
    expect(screen.getByText(areaText("Bereits belegt", "3,00"))).toBeInTheDocument();
    expect(screen.getByText(areaText("Verfügbare Restfläche", "4,00"))).toBeInTheDocument();
  });

  it("shows the corrected remaining-area values for the Majoran overlap scenario", async () => {
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "1", field: 11, area_sqm: 7 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 21,
            bed: 101,
            crop: 2,
            planting_date: "20.9.2026",
            harvest_end_date: "2.2.2027",
            area_usage_sqm: 7,
          },
          {
            id: 23,
            bed: 101,
            crop: 2,
            planting_date: "2.2.2026",
            harvest_end_date: "2.6.2026",
            area_usage_sqm: 3,
          },
          {
            id: 22,
            bed: 101,
            crop: 2,
            planting_date: "20.2.2026",
            harvest_end_date: "18.9.2026",
            area_usage_sqm: 1,
          },
        ],
      },
    });
    mockGridRowState.row = {
      id: 22,
      bed: 101,
      crop: 2,
      planting_date: "20.2.2026",
      harvest_end_date: "18.9.2026",
      area_m2: "5",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    expect(await screen.findByText("Die angegebene Fläche überschreitet die verfügbare Restfläche dieses Beets.")).toBeInTheDocument();
    expect(screen.getByText(areaText("Beetfläche", "7,00"))).toBeInTheDocument();
    expect(screen.getByText(areaText("Bereits belegt", "3,00"))).toBeInTheDocument();
    expect(screen.getByText(areaText("Verfügbare Restfläche", "4,00"))).toBeInTheDocument();
    expect(screen.getByText(areaText("Übernommen wird", "4,00"))).toBeInTheDocument();
    expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(false);
  });

  it("allows saving the Majoran row when the requested area fits the corrected remaining area", async () => {
    apiMocks.bedList.mockResolvedValue({ data: { results: [{ id: 101, name: "1", field: 11, area_sqm: 7 }] } });
    apiMocks.planList.mockResolvedValue({
      data: {
        results: [
          {
            id: 21,
            bed: 101,
            crop: 2,
            planting_date: "20.9.2026",
            harvest_end_date: "2.2.2027",
            area_usage_sqm: 7,
          },
          {
            id: 23,
            bed: 101,
            crop: 2,
            planting_date: "2.2.2026",
            harvest_end_date: "2.6.2026",
            area_usage_sqm: 3,
          },
          {
            id: 22,
            bed: 101,
            crop: 2,
            planting_date: "20.2.2026",
            harvest_end_date: "18.9.2026",
            area_usage_sqm: 1,
          },
        ],
      },
    });
    mockGridRowState.row = {
      id: 22,
      bed: 101,
      crop: 2,
      planting_date: "20.2.2026",
      harvest_end_date: "18.9.2026",
      area_m2: "4",
    };
    render(<MemoryRouter><PlantingPlans /></MemoryRouter>);
    await waitForPlansToLoad();
    await userEvent.click(await screen.findByRole("button", { name: "Zeile speichern" }));

    expect(commandApiSpies.saveAttemptResult).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText("Die angegebene Fläche überschreitet die verfügbare Restfläche dieses Beets.")).not.toBeInTheDocument();
  });
});
