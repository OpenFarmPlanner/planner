import { describe, expect, it } from "vitest";
import { CollisionService } from "../../../gantt-chart/src/services/CollisionService";
import type { Task } from "../../../gantt-chart/src/types";
import {
  buildMovePreviewTasks,
  getLinkedTasks,
} from "../../../gantt-chart/src/utils/linkedTasks";

const utcDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

const growth: Task = {
  id: "plan-1-growth",
  name: "Salat",
  startDate: utcDate("2026-04-01"),
  endDate: utcDate("2026-05-20"),
  linkGroupId: "plan-1",
};
const harvest: Task = {
  id: "plan-1-harvest",
  name: "Ernte",
  startDate: utcDate("2026-05-20"),
  endDate: utcDate("2026-06-10"),
  linkGroupId: "plan-1",
};
const other: Task = {
  id: "plan-2-growth",
  name: "Karotte",
  startDate: utcDate("2026-04-01"),
  endDate: utcDate("2026-04-20"),
  linkGroupId: "plan-2",
};

describe("getLinkedTasks", () => {
  it("returns the other tasks sharing the link group", () => {
    expect(getLinkedTasks(growth, [growth, harvest, other])).toEqual([harvest]);
  });

  it("returns nothing for a task without a link group", () => {
    const unlinked: Task = { ...growth, linkGroupId: undefined };
    expect(getLinkedTasks(unlinked, [unlinked, harvest])).toEqual([]);
  });
});

describe("buildMovePreviewTasks", () => {
  it("shifts the dragged and linked tasks by the same whole days and keeps durations", () => {
    // A local-midnight drop position a couple of hours off UTC still counts as that day.
    const dropStart = new Date(utcDate("2026-04-11").getTime() - 2 * 3_600_000);

    const [movedGrowth, movedHarvest, ...rest] = buildMovePreviewTasks(
      growth,
      dropStart,
      [growth, harvest, other],
    );

    expect(rest).toEqual([]);
    expect([iso(movedGrowth.startDate), iso(movedGrowth.endDate)]).toEqual([
      "2026-04-11",
      "2026-05-30",
    ]);
    expect([iso(movedHarvest.startDate), iso(movedHarvest.endDate)]).toEqual([
      "2026-05-30",
      "2026-06-20",
    ]);
    expect(movedHarvest.startDate.getTime() - movedGrowth.startDate.getTime()).toBe(
      harvest.startDate.getTime() - growth.startDate.getTime(),
    );
  });

  it("returns the original dates when the drop lands on the start day", () => {
    const [unchanged, linked] = buildMovePreviewTasks(growth, growth.startDate, [growth, harvest]);
    expect(unchanged.startDate).toEqual(growth.startDate);
    expect(linked.endDate).toEqual(harvest.endDate);
  });
});

describe("CollisionService.getPreviewArrangement", () => {
  it("applies several previewed tasks at once", () => {
    const preview = buildMovePreviewTasks(growth, utcDate("2026-04-11"), [growth, harvest, other]);
    const rows = CollisionService.getPreviewArrangement(preview, [growth, harvest, other]);
    const arranged = rows.flat();

    expect(iso(arranged.find((task) => task.id === harvest.id)!.startDate)).toBe("2026-05-30");
    expect(arranged.find((task) => task.id === other.id)).toBe(other);
  });
});
