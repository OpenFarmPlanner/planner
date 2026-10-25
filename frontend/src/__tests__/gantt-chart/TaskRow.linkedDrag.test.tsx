import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRow } from "../../gantt-chart/src/components/task";
import { ViewMode, type Task, type TaskGroup } from "../../gantt-chart/src";

const DAY_WIDTH = 10;
const TIMELINE_START = new Date(2026, 4, 1);
const TIMELINE_END = new Date(2026, 4, 31);

const growth: Task = {
  id: "plan-1-growth",
  name: "Salat",
  startDate: new Date(2026, 4, 3),
  endDate: new Date(2026, 4, 10),
  linkGroupId: "plan-1",
};
const harvest: Task = {
  id: "plan-1-harvest",
  name: "Ernte Salat",
  startDate: new Date(2026, 4, 10),
  endDate: new Date(2026, 4, 14),
  linkGroupId: "plan-1",
};
const unrelated: Task = {
  id: "plan-2-growth",
  name: "Karotte",
  startDate: new Date(2026, 4, 20),
  endDate: new Date(2026, 4, 25),
  linkGroupId: "plan-2",
};

const group: TaskGroup = {
  id: "bed-1",
  name: "Beet 1",
  tasks: [growth, harvest, unrelated],
};

const renderRow = (onTaskUpdate = vi.fn()) => {
  render(
    <TaskRow
      taskGroup={group}
      startDate={TIMELINE_START}
      endDate={TIMELINE_END}
      totalMonths={31}
      monthWidth={DAY_WIDTH}
      viewMode={ViewMode.DAY}
      allowTaskResize={false}
      onTaskUpdate={onTaskUpdate}
    />,
  );
  return onTaskUpdate;
};

const bar = (task: Task) => screen.getByTestId(`task-${task.id}`);
const leftOf = (task: Task) => parseFloat(bar(task).style.left);

const dragBy = (task: Task, deltaX: number) => {
  fireEvent.mouseDown(bar(task), { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(screen.getByTestId("task-row-bed-1"), {
    clientX: deltaX,
    clientY: 0,
  });
};

const dayDiff = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);

describe("TaskRow linked task drag", () => {
  it("moves the linked harvest bar live with the dragged growth bar", () => {
    renderRow();
    const initialGrowthLeft = leftOf(growth);
    const initialHarvestLeft = leftOf(harvest);
    const initialUnrelatedLeft = leftOf(unrelated);

    dragBy(growth, 5 * DAY_WIDTH);

    expect(leftOf(growth)).toBe(initialGrowthLeft + 5 * DAY_WIDTH);
    expect(leftOf(harvest)).toBe(initialHarvestLeft + 5 * DAY_WIDTH);
    expect(leftOf(harvest) - leftOf(growth)).toBe(initialHarvestLeft - initialGrowthLeft);
    expect(leftOf(unrelated)).toBe(initialUnrelatedLeft);
  });

  it("marks every bar of the plan as dragging, but no other bar", () => {
    renderRow();

    dragBy(growth, 2 * DAY_WIDTH);

    expect(bar(growth)).toHaveAttribute("data-dragging", "true");
    expect(bar(harvest)).toHaveAttribute("data-dragging", "true");
    expect(bar(harvest)).toHaveClass("rmg-task-item-dragging");
    expect(bar(unrelated)).toHaveAttribute("data-dragging", "false");
  });

  it("drops the dragged bar with its duration and the previewed day offset", () => {
    const onTaskUpdate = renderRow();

    dragBy(growth, 5 * DAY_WIDTH);
    const previewHarvestLeft = leftOf(harvest);
    act(() => {
      fireEvent.mouseUp(document);
    });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, droppedTask] = onTaskUpdate.mock.calls[0] as [string, Task];
    expect(droppedTask.id).toBe(growth.id);
    expect(dayDiff(droppedTask.startDate, growth.startDate)).toBe(5);
    expect(dayDiff(droppedTask.endDate, droppedTask.startDate)).toBe(
      dayDiff(growth.endDate, growth.startDate),
    );
    // The harvest bar was previewed exactly five days later as well.
    expect(previewHarvestLeft - leftOf(harvest)).toBe(5 * DAY_WIDTH);
  });

  it("moves the whole plan when the harvest bar is dragged", () => {
    const onTaskUpdate = renderRow();
    const initialGrowthLeft = leftOf(growth);
    const initialHarvestLeft = leftOf(harvest);

    dragBy(harvest, -2 * DAY_WIDTH);

    expect(leftOf(harvest)).toBe(initialHarvestLeft - 2 * DAY_WIDTH);
    expect(leftOf(growth)).toBe(initialGrowthLeft - 2 * DAY_WIDTH);

    act(() => {
      fireEvent.mouseUp(document);
    });
    const [, droppedTask] = onTaskUpdate.mock.calls[0] as [string, Task];
    expect(droppedTask.id).toBe(harvest.id);
    expect(dayDiff(droppedTask.startDate, harvest.startDate)).toBe(-2);
  });

  it("restores every bar of the plan and commits nothing when Escape cancels the drag", () => {
    const onTaskUpdate = renderRow();
    const initialGrowthLeft = leftOf(growth);
    const initialHarvestLeft = leftOf(harvest);

    dragBy(growth, 4 * DAY_WIDTH);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(leftOf(growth)).toBe(initialGrowthLeft);
    expect(leftOf(harvest)).toBe(initialHarvestLeft);
    expect(bar(growth)).toHaveAttribute("data-dragging", "false");
    expect(bar(harvest)).toHaveAttribute("data-dragging", "false");

    act(() => {
      fireEvent.mouseUp(document);
    });
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });
});
