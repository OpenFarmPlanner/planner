export interface Task {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  color?: string;
  percent?: number;
  dependencies?: string[];
  [key: string]: any;
}

export interface TaskGroup {
  id: string;
  name: string;
  description?: string;
  /**
   * Optional structured hierarchy metadata for rendering resource trees,
   * e.g. Location -> Field -> Bed.
   */
  hierarchyPath?: string[];
  locationName?: string;
  fieldName?: string;
  bedName?: string;
  tasks: Task[];
  /**
   * Tree-row rendering hints. All optional and purely presentational — the
   * caller (e.g. an app page) is responsible for computing the actual tree
   * structure, flattening it into a visible-row list, and passing depth /
   * isExpandable / isExpanded per group. Without these, a group renders
   * exactly as before (flat row, no chevron/indent).
   */
  depth?: number;
  isExpandable?: boolean;
  isExpanded?: boolean;
  /**
   * Shown in the timeline area instead of bars when `tasks` is empty —
   * e.g. a parent row summarizing its children ("2 fields · 6 beds ·
   * 5 occupied"). Rendered as quiet secondary text pinned to the start of
   * the row, so it stays clear of the sticky left column and adds no row
   * height of its own. Purely a caller-provided string; this library has no
   * opinion on its content.
   */
  emptyRowLabel?: string;
  /**
   * Overrides the computed row height for this group only (e.g. a compact
   * height for a tree parent row that has no bars of its own). Falls back
   * to the normal task-row-count-based height when unset.
   */
  rowHeightOverride?: number;
  [key: string]: any;
}

export interface GanttStyles {
  container?: string;
  title?: string;
  header?: string;
  taskList?: string;
  timeline?: string;
  todayMarker?: string;
  taskRow?: string;
  taskItem?: string;
  tooltip?: string;
}
