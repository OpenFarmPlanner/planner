import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { GanttChart, ViewMode, type TaskGroup } from "../../gantt-chart/src";

const createTask = (id: string, name: string) => ({
  id,
  name,
  startDate: new Date(2026, 0, 1),
  endDate: new Date(2026, 0, 10),
});

const createHierarchyDemoData = (includeLocationLevel: boolean): TaskGroup[] => {
  const withLocation = (field: string, bed: string, location: string) =>
    includeLocationLevel ? [location, field, bed] : [field, bed];

  return [
    {
      id: "bed-1",
      name: "Bed A1",
      hierarchyPath: withLocation("Field North", "Bed A1", "Location Green Farm"),
      tasks: [createTask("crop-1", "Carrot")],
    },
    {
      id: "bed-2",
      name: "Bed B1",
      hierarchyPath: withLocation("Field South", "Bed B1", "Location Green Farm"),
      tasks: [createTask("crop-2", "Lettuce")],
    },
    {
      id: "bed-3",
      name: "Bed C1",
      hierarchyPath: withLocation("Field West", "Bed C1", "Location Green Farm"),
      tasks: [createTask("crop-3", "Beans")],
    },
  ];
};

describe("TaskList hierarchy location visibility", () => {
  test("renders explicit three-level hierarchy path", () => {
    const tasks: TaskGroup[] = [
      {
        id: "group-1",
        name: "Bed 1",
        hierarchyPath: ["Location North Farm", "Field A", "Bed 1"],
        tasks: [createTask("task-1", "Carrot")],
      },
    ];

    render(
      <GanttChart tasks={tasks} viewMode={ViewMode.MONTH} viewModes={false} />,
    );

    expect(screen.getByText("Location North Farm")).toBeInTheDocument();
    expect(screen.getByText("Field A")).toBeInTheDocument();
    expect(screen.getByText("Bed 1")).toBeInTheDocument();
  });

  test("renders explicit two-level hierarchy path", () => {
    const tasks: TaskGroup[] = [
      {
        id: "group-1",
        name: "Bed 1",
        hierarchyPath: ["Field North", "Bed 1"],
        tasks: [createTask("task-1", "Carrot")],
      },
    ];

    render(
      <GanttChart tasks={tasks} viewMode={ViewMode.MONTH} viewModes={false} />,
    );

    expect(screen.queryByText("Location North Farm")).not.toBeInTheDocument();
    expect(screen.getByText("Field North")).toBeInTheDocument();
    expect(screen.getByText("Bed 1")).toBeInTheDocument();
  });

  test("does not infer visibility from dataset uniqueness when hierarchyPath includes location", () => {
    const tasks: TaskGroup[] = [
      {
        id: "group-1",
        name: "Bed 1",
        hierarchyPath: ["Location Green Farm", "Field A", "Bed 1"],
        tasks: [createTask("task-1", "Carrot")],
      },
      {
        id: "group-2",
        name: "Bed 2",
        hierarchyPath: ["Location Green Farm", "Field B", "Bed 2"],
        tasks: [createTask("task-2", "Lettuce")],
      },
    ];

    render(
      <GanttChart tasks={tasks} viewMode={ViewMode.MONTH} viewModes={false} />,
    );

    expect(screen.getAllByText("Location Green Farm")).toHaveLength(2);
  });

  test("demo toggle changes input hierarchy shape and renderer output", () => {
    const { rerender } = render(
      <GanttChart
        tasks={createHierarchyDemoData(true)}
        viewMode={ViewMode.MONTH}
        viewModes={false}
      />,
    );

    expect(screen.getAllByText("Location Green Farm")).toHaveLength(3);

    rerender(
      <GanttChart
        tasks={createHierarchyDemoData(false)}
        viewMode={ViewMode.MONTH}
        viewModes={false}
      />,
    );

    expect(screen.queryByText("Location Green Farm")).not.toBeInTheDocument();
    expect(screen.getByText("Field North")).toBeInTheDocument();
  });
});

describe("TaskList tree row expand toggle", () => {
  const treeRows: TaskGroup[] = [
    { id: "location-1", name: "Regenbogenland", depth: 0, isExpandable: true, isExpanded: true, tasks: [] },
    { id: "field-1", name: "Nordfeld", depth: 1, isExpandable: true, isExpanded: false, tasks: [] },
    { id: "bed-1", name: "Beet 1", depth: 2, tasks: [createTask("task-1", "Karotte")] },
  ];

  const renderTree = (props: Partial<React.ComponentProps<typeof GanttChart>> = {}) => {
    const onToggleGroupExpand = vi.fn();
    const onGroupContextMenu = vi.fn();
    render(
      <GanttChart
        tasks={treeRows}
        viewMode={ViewMode.MONTH}
        viewModes={false}
        onToggleGroupExpand={onToggleGroupExpand}
        onGroupContextMenu={onGroupContextMenu}
        {...props}
      />,
    );
    return { onToggleGroupExpand, onGroupContextMenu };
  };

  test.each([
    ["location-1", "Regenbogenland"],
    ["field-1", "Nordfeld"],
  ])("toggles %s when its name is clicked", (groupId, name) => {
    const { onToggleGroupExpand } = renderTree();

    fireEvent.click(screen.getByText(name));

    expect(onToggleGroupExpand).toHaveBeenCalledTimes(1);
    expect(onToggleGroupExpand).toHaveBeenCalledWith(groupId);
  });

  test("toggles when the chevron is clicked", () => {
    const { onToggleGroupExpand } = renderTree();
    const row = screen.getByTestId("task-group-location-1");

    fireEvent.click(row.querySelector('[data-rmg-component="task-group-chevron"]')!);

    expect(onToggleGroupExpand).toHaveBeenCalledTimes(1);
    expect(onToggleGroupExpand).toHaveBeenCalledWith("location-1");
  });

  test("does not toggle when the context menu button is clicked", () => {
    const { onToggleGroupExpand, onGroupContextMenu } = renderTree({ contextMenuLabel: "Weitere Aktionen" });
    const row = screen.getByTestId("task-group-location-1");

    fireEvent.click(row.querySelector("button")!);

    expect(onGroupContextMenu).toHaveBeenCalledTimes(1);
    expect(onToggleGroupExpand).not.toHaveBeenCalled();
  });

  test("toggles with Enter and Space and exposes the expansion state", () => {
    const { onToggleGroupExpand } = renderTree();
    const locationRow = screen.getByRole("button", { name: "Regenbogenland" });
    const fieldRow = screen.getByRole("button", { name: "Nordfeld" });

    expect(locationRow).toHaveAttribute("tabindex", "0");
    expect(locationRow).toHaveAttribute("aria-expanded", "true");
    expect(fieldRow).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(locationRow, { key: "Enter" });
    fireEvent.keyDown(fieldRow, { key: " " });
    fireEvent.keyDown(fieldRow, { key: "a" });

    expect(onToggleGroupExpand.mock.calls).toEqual([["location-1"], ["field-1"]]);
  });

  test("reflects a changed expansion state from outside, e.g. the global expand controls", () => {
    const { rerender } = render(
      <GanttChart tasks={treeRows} viewMode={ViewMode.MONTH} viewModes={false} onToggleGroupExpand={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Regenbogenland" })).toHaveAttribute("aria-expanded", "true");

    rerender(
      <GanttChart
        tasks={treeRows.map((row) => (row.isExpandable ? { ...row, isExpanded: false } : row))}
        viewMode={ViewMode.MONTH}
        viewModes={false}
        onToggleGroupExpand={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Regenbogenland" })).toHaveAttribute("aria-expanded", "false");
  });

  test("marks only expandable rows as clickable and focusable", () => {
    const { onToggleGroupExpand } = renderTree();
    const bedRow = screen.getByTestId("task-group-bed-1");

    expect(screen.getByTestId("task-group-location-1")).toHaveAttribute("data-clickable", "true");
    expect(bedRow).not.toHaveAttribute("data-clickable");
    expect(bedRow).not.toHaveAttribute("role");
    expect(bedRow).not.toHaveAttribute("tabindex");
    expect(bedRow).not.toHaveAttribute("aria-expanded");

    fireEvent.click(screen.getByText("Beet 1"));
    fireEvent.keyDown(bedRow, { key: "Enter" });

    expect(onToggleGroupExpand).not.toHaveBeenCalled();
  });

  test("is not clickable when the host does not handle expansion", () => {
    render(<GanttChart tasks={treeRows} viewMode={ViewMode.MONTH} viewModes={false} />);

    expect(screen.getByTestId("task-group-location-1")).not.toHaveAttribute("data-clickable");
    expect(screen.queryByRole("button", { name: "Regenbogenland" })).not.toBeInTheDocument();
  });
});
