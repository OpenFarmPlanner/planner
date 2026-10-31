import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Locations from "../pages/Locations";

const apiMocks = vi.hoisted(() => ({
  locationList: vi.fn(),
  fieldList: vi.fn(),
  bedList: vi.fn(),
  planList: vi.fn(),
  cropList: vi.fn(),
}));

const projectRequirementState = vi.hoisted(() => ({
  shouldShowProjectRequiredState: false,
  missingProjectReason: null as null | "no_projects" | "no_active_project",
}));

vi.mock("../hooks/useProjectRequirement", () => ({
  useProjectRequirement: () => projectRequirementState,
}));

vi.mock("../commands/useCommandContext", () => ({
  useRegisterCreateActions: vi.fn(),
}));

vi.mock("../api/api", async () => {
  const actual = await vi.importActual<typeof import("../api/api")>("../api/api");
  return {
    ...actual,
    locationAPI: {
      ...actual.locationAPI,
      list: apiMocks.locationList,
      listAll: async () => (await apiMocks.locationList()).data,
    },
    fieldAPI: {
      ...actual.fieldAPI,
      list: apiMocks.fieldList,
    },
    bedAPI: {
      ...actual.bedAPI,
      list: apiMocks.bedList,
    },
    plantingPlanAPI: {
      ...actual.plantingPlanAPI,
      list: apiMocks.planList,
    },
    cropAPI: {
      ...actual.cropAPI,
      list: apiMocks.cropList,
    },
  };
});

describe("Locations project requirement state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectRequirementState.shouldShowProjectRequiredState = false;
    projectRequirementState.missingProjectReason = null;
    apiMocks.locationList.mockResolvedValue({ data: { results: [] } });
    apiMocks.fieldList.mockResolvedValue({ data: { results: [] } });
    apiMocks.bedList.mockResolvedValue({ data: { results: [] } });
    apiMocks.planList.mockResolvedValue({ data: { results: [] } });
    apiMocks.cropList.mockResolvedValue({ data: { results: [] } });
  });

  it("shows friendly info instead of an error when the user has no project", async () => {
    projectRequirementState.shouldShowProjectRequiredState = true;
    projectRequirementState.missingProjectReason = "no_projects";

    render(
      <MemoryRouter>
        <Locations />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Du hast noch kein Projekt.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erstes Projekt anlegen" })).toBeInTheDocument();
    expect(screen.queryByText("Fehler beim Laden der Standorte")).not.toBeInTheDocument();
    expect(apiMocks.locationList).not.toHaveBeenCalled();
  });

  it("still shows a red error for real loading failures with an active project", async () => {
    apiMocks.locationList.mockRejectedValueOnce(new Error("network failed"));

    render(
      <MemoryRouter>
        <Locations />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Fehler beim Laden der Standorte")).toBeInTheDocument();
    });
  });

  it("does not render upcoming tasks section in location cards", async () => {
    apiMocks.locationList.mockResolvedValue({ data: { results: [{ id: 1, name: "Hof" }] } });

    render(
      <MemoryRouter>
        <Locations />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Hof")).toBeInTheDocument();
    expect(screen.queryByText("Anstehende Aufgaben")).not.toBeInTheDocument();
  });

  it("uses the same create dialog flow for header and empty-state add actions", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(
      <MemoryRouter>
        <Locations />
      </MemoryRouter>,
    );

    const emptyStateButton = await screen.findByRole("button", { name: "Standort hinzufügen" });
    fireEvent.click(emptyStateButton);
    expect(await screen.findByRole("heading", { name: "Standort hinzufügen" })).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter>
        <Locations />
      </MemoryRouter>,
    );
    const headerButton = await screen.findByRole("button", { name: "Standort hinzufügen" });
    fireEvent.click(headerButton);
    expect(await screen.findByRole("heading", { name: "Standort hinzufügen" })).toBeInTheDocument();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("opens the existing create dialog from query intent and clears create parameter", async () => {
    render(
      <MemoryRouter initialEntries={["/app/locations?create=true"]}>
        <Locations />
      </MemoryRouter>,
    );

    const createDialogHeadings = await screen.findAllByRole("heading", { name: "Standort hinzufügen" });
    expect(createDialogHeadings).toHaveLength(1);
  });
});
