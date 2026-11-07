/**
 * Pure view-state helpers for the Gantt calendar page: persisted view/state
 * storage, timeline date/scroll math, row sizing, and synthetic touch-to-mouse
 * event helpers. Extracted verbatim from pages/GanttChart.tsx.
 */

import { ViewMode } from '../gantt-chart/src';
import { CollisionService } from '../gantt-chart/src/services/CollisionService';
import { estimateTaskGroupLabelHeight } from '../gantt-chart/src/utils';
import { parseDateString } from './ganttChartUtils';
import type { GanttTaskGroup } from './ganttChartUtils';

export type CalendarMode = 'occupancy' | 'seedlings';

export const CALENDAR_VIEW_STORAGE_KEY = 'openFarmPlanner.ganttChart.view';
export const CALENDAR_TIMELINE_VIEW_MODE_STORAGE_KEY = 'openFarmPlanner.ganttChart.timelineViewMode';
export const GANTT_STATE_STORAGE_PREFIX = 'openfarmplanner:gantt';
export const DEFAULT_TIMELINE_VIEW_MODE = ViewMode.MONTH;
export const GANTT_LEFT_COLUMN_DESKTOP_MIN_WIDTH = 190;
export const GANTT_LEFT_COLUMN_DESKTOP_DEFAULT_WIDTH = 240;
export const GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH = 400;
export const GANTT_LEFT_COLUMN_MOBILE_MIN_WIDTH = 104;
export const GANTT_LEFT_COLUMN_MOBILE_DEFAULT_WIDTH = 132;
export const GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH = 216;
export const GANTT_SIDEBAR_RESIZE_HANDLE_DESKTOP_HITBOX_WIDTH = 12;
export const GANTT_SIDEBAR_RESIZE_HANDLE_MOBILE_HITBOX_WIDTH = 24;
export const GANTT_SIDEBAR_RESIZE_KEYBOARD_STEP = 10;
export const GANTT_ROW_HEIGHT = 32;
// Desktop/tablet calendar viewport height is capped dynamically at
// `window.innerHeight - <viewport top> - GANTT_VIEWPORT_BOTTOM_MARGIN_PX`
// (see GanttChart.tsx) so the panel always leaves a fixed, predictable gap
// to the bottom of the screen instead of a viewport-percentage cap that
// under- or over-shoots depending on screen height.
export const GANTT_VIEWPORT_BOTTOM_MARGIN_PX = 24;
export const GANTT_VIEWPORT_MIN_HEIGHT_PX = 320;
// Above this many combined location+field+bed nodes, default to
// locations-expanded/fields-collapsed instead of fully expanding the tree.
export const OCCUPANCY_TREE_AUTO_EXPAND_ALL_THRESHOLD = 30;
// Compact row height for Standort/Parzelle rows, which show a structural
// meta-text summary ("2 Parzellen · 6 Beete · 5 belegt") in their timeline
// area instead of bars. Beet rows keep the normal, task-count-based height
// computed by the Gantt library itself. Must be tall enough to fit the
// sidebar's single content line (chevron + name, ~17px) plus its ~8px
// vertical padding without TaskList's minHeight being exceeded by actual
// content — otherwise the sidebar row silently renders taller than
// TaskRow's timeline row and the two columns drift out of sync row by row.
// The summary itself is a single short line inside the timeline row, so it
// stays well under this height on that side too.
export const OCCUPANCY_COMPACT_ROW_HEIGHT = 32;
export const GANTT_HEADER_VIEW_MODES = [
  ViewMode.DAY,
  ViewMode.WEEK,
  ViewMode.MONTH,
  ViewMode.QUARTER,
  ViewMode.YEAR,
] as const;
export const GANTT_UNIT_WIDTH_BY_VIEW_MODE: Record<ViewMode, number> = {
  [ViewMode.MINUTE]: 60,
  [ViewMode.HOUR]: 80,
  [ViewMode.DAY]: 50,
  [ViewMode.WEEK]: 80,
  [ViewMode.MONTH]: 150,
  [ViewMode.QUARTER]: 180,
  [ViewMode.YEAR]: 200,
};

export function clampGanttLeftColumnWidth(width: number, useMobileLimits = false): number {
  const minWidth = useMobileLimits ? GANTT_LEFT_COLUMN_MOBILE_MIN_WIDTH : GANTT_LEFT_COLUMN_DESKTOP_MIN_WIDTH;
  const maxWidth = useMobileLimits ? GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH : GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH;
  return Math.min(
    maxWidth,
    Math.max(minWidth, Math.round(width)),
  );
}

export function getCalendarGanttRowHeight(group: GanttTaskGroup, viewMode: ViewMode, leftColumnWidth: number): number {
  if (group.rowHeightOverride !== undefined) {
    return group.rowHeightOverride;
  }

  const estimatedLabelHeight = estimateTaskGroupLabelHeight(group, leftColumnWidth);
  const taskRows = CollisionService.detectOverlaps(group.tasks, viewMode);
  return Math.max(estimatedLabelHeight, taskRows.length * GANTT_ROW_HEIGHT + 12);
}

export const CALENDAR_SHORTCUT_VIEW_MODES: Array<{ mode: ViewMode; shortcut: string; labelKey: string }> = [
  { mode: ViewMode.DAY, shortcut: '1', labelKey: 'dayView' },
  { mode: ViewMode.WEEK, shortcut: '2', labelKey: 'weekView' },
  { mode: ViewMode.MONTH, shortcut: '3', labelKey: 'monthView' },
  { mode: ViewMode.QUARTER, shortcut: '4', labelKey: 'quarterView' },
  { mode: ViewMode.YEAR, shortcut: '5', labelKey: 'yearView' },
];

export interface StoredGanttState {
  calendarMode?: CalendarMode;
  timelineViewMode?: ViewMode;
  referenceDate?: string;
  rowScrollTop?: number;
  leftColumnWidth?: number;
  leftColumnWidthDesktop?: number;
  leftColumnWidthMobile?: number;
}

export function getCalendarModeFromViewParam(viewParam: string | null): CalendarMode {
  return viewParam === 'seedlings' ? 'seedlings' : 'occupancy';
}

export function getViewParamFromCalendarMode(mode: CalendarMode): string {
  return mode === 'seedlings' ? 'seedlings' : 'field';
}

export function isCalendarViewParam(value: string | null): value is 'field' | 'seedlings' {
  return value === 'field' || value === 'seedlings';
}

export function getCalendarViewStorageKey(activeProjectId: number | null): string {
  return activeProjectId ? `${CALENDAR_VIEW_STORAGE_KEY}.${activeProjectId}` : CALENDAR_VIEW_STORAGE_KEY;
}

export function getTimelineViewModeStorageKey(activeProjectId: number | null): string {
  return activeProjectId
    ? `${CALENDAR_TIMELINE_VIEW_MODE_STORAGE_KEY}.${activeProjectId}`
    : CALENDAR_TIMELINE_VIEW_MODE_STORAGE_KEY;
}

export function getGanttStateStorageKey(activeProjectId: number | null): string | null {
  return activeProjectId ? `${GANTT_STATE_STORAGE_PREFIX}:${activeProjectId}:state` : null;
}

export function getStoredCalendarMode(storageKey: string): CalendarMode | null {
  const storedValue = window.localStorage.getItem(storageKey);
  return isCalendarViewParam(storedValue) ? getCalendarModeFromViewParam(storedValue) : null;
}

export function storeCalendarMode(storageKey: string, mode: CalendarMode): void {
  window.localStorage.setItem(storageKey, getViewParamFromCalendarMode(mode));
}

export function isTimelineViewMode(value: string | null): value is ViewMode {
  return value !== null && (GANTT_HEADER_VIEW_MODES as readonly string[]).includes(value);
}

export function storeTimelineViewMode(storageKey: string, mode: ViewMode): void {
  window.localStorage.setItem(storageKey, mode);
}

export function getStoredGanttState(storageKey: string | null): StoredGanttState | null {
  if (!storageKey) {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (!storedValue) {
      return null;
    }
    const parsed = JSON.parse(storedValue) as StoredGanttState;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      calendarMode: parsed.calendarMode === 'occupancy' || parsed.calendarMode === 'seedlings'
        ? parsed.calendarMode
        : undefined,
      timelineViewMode: isTimelineViewMode(parsed.timelineViewMode ?? null)
        ? parsed.timelineViewMode
        : undefined,
      referenceDate: typeof parsed.referenceDate === 'string' ? parsed.referenceDate : undefined,
      rowScrollTop: typeof parsed.rowScrollTop === 'number' && Number.isFinite(parsed.rowScrollTop)
        ? parsed.rowScrollTop
        : undefined,
      leftColumnWidth: typeof parsed.leftColumnWidth === 'number' && Number.isFinite(parsed.leftColumnWidth)
        ? clampGanttLeftColumnWidth(parsed.leftColumnWidth)
        : undefined,
      leftColumnWidthDesktop: typeof parsed.leftColumnWidthDesktop === 'number' && Number.isFinite(parsed.leftColumnWidthDesktop)
        ? clampGanttLeftColumnWidth(parsed.leftColumnWidthDesktop)
        : undefined,
      leftColumnWidthMobile: typeof parsed.leftColumnWidthMobile === 'number' && Number.isFinite(parsed.leftColumnWidthMobile)
        ? clampGanttLeftColumnWidth(parsed.leftColumnWidthMobile, true)
        : undefined,
    };
  } catch {
    return null;
  }
}

export function storeGanttState(storageKey: string | null, nextState: StoredGanttState): void {
  if (!storageKey) {
    return;
  }

  const currentState = getStoredGanttState(storageKey) ?? {};
  window.localStorage.setItem(storageKey, JSON.stringify({
    ...currentState,
    ...nextState,
  }));
}

export function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

export function clampDate(date: Date, startDate: Date, endDate: Date): Date {
  if (date < startDate) {
    return new Date(startDate);
  }
  if (date > endDate) {
    return new Date(endDate);
  }
  return date;
}

export function getStoredReferenceDate(state: StoredGanttState | null, startDate: Date, endDate: Date): Date | null {
  if (!state?.referenceDate) {
    return null;
  }

  const date = parseDateString(state.referenceDate);
  if (!isValidDate(date) || date < startDate || date > endDate) {
    return null;
  }
  return date;
}

export function getStoredTimelineViewModeFromState(state: StoredGanttState | null): ViewMode | null {
  return state?.referenceDate && state.timelineViewMode ? state.timelineViewMode : null;
}

export function getInitialTimelineReferenceDate(state: StoredGanttState | null, startDate: Date, endDate: Date): Date {
  return getStoredReferenceDate(state, startDate, endDate) ?? clampDate(new Date(), startDate, endDate);
}

export function getGanttUnitWidth(viewMode: ViewMode): number {
  return GANTT_UNIT_WIDTH_BY_VIEW_MODE[viewMode] ?? GANTT_UNIT_WIDTH_BY_VIEW_MODE[ViewMode.MONTH];
}

function monthsBetween(start: Date, date: Date): number {
  return (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth();
}

export function getDatePosition(date: Date, viewMode: ViewMode, startDate: Date): number {
  const unitWidth = getGanttUnitWidth(viewMode);
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  switch (viewMode) {
    case ViewMode.DAY: {
      // Calendar days, not elapsed 24 h blocks: between the DST switches a
      // local midnight is 23 h or 25 h after the previous one, and flooring
      // the elapsed time put every summer date one column too early (#906).
      const day = new Date(date);
      day.setHours(0, 0, 0, 0);
      const days = Math.round((day.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      return days * unitWidth + unitWidth / 2;
    }
    case ViewMode.WEEK: {
      const days = Math.max(0, (date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      return (days / 7) * unitWidth;
    }
    case ViewMode.MONTH:
      // Month and quarter columns continue across the year boundary: a range
      // that ends in the next year must not fold its dates back (#906).
      return (monthsBetween(start, date) + ((date.getDate() - 1) / new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate())) * unitWidth;
    case ViewMode.QUARTER: {
      const quarterIndex = Math.floor((date.getFullYear() * 12 + date.getMonth()) / 3)
        - Math.floor((start.getFullYear() * 12 + start.getMonth()) / 3);
      const monthInQuarter = date.getMonth() % 3;
      return (quarterIndex + monthInQuarter / 3) * unitWidth;
    }
    case ViewMode.YEAR:
      return ((date.getFullYear() - start.getFullYear()) + date.getMonth() / 12) * unitWidth;
    default:
      return 0;
  }
}

export function getReferenceDateFromScroll(
  scrollLeft: number,
  containerWidth: number,
  viewMode: ViewMode,
  startDate: Date,
  endDate: Date,
  leftColumnWidth: number,
): Date {
  const unitWidth = getGanttUnitWidth(viewMode);
  const timelineViewportWidth = Math.max(0, containerWidth - leftColumnWidth);
  const centerPosition = Math.max(0, scrollLeft + timelineViewportWidth / 2);
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const nextDate = new Date(start);

  switch (viewMode) {
    case ViewMode.DAY:
      nextDate.setDate(start.getDate() + Math.floor(centerPosition / unitWidth));
      break;
    case ViewMode.WEEK:
      nextDate.setDate(start.getDate() + Math.floor((centerPosition / unitWidth) * 7));
      break;
    case ViewMode.MONTH:
      nextDate.setMonth(start.getMonth() + Math.floor(centerPosition / unitWidth), 1);
      break;
    case ViewMode.QUARTER:
      nextDate.setMonth(start.getMonth() + Math.floor(centerPosition / unitWidth) * 3, 1);
      break;
    case ViewMode.YEAR:
      nextDate.setFullYear(start.getFullYear() + Math.floor(centerPosition / unitWidth), 0, 1);
      break;
    default:
      break;
  }

  return clampDate(nextDate, startDate, endDate);
}

export function getTimelineScrollLeftForDate(
  date: Date,
  viewMode: ViewMode,
  startDate: Date,
  container: HTMLElement,
  leftColumnWidth: number,
): number {
  const position = getDatePosition(date, viewMode, startDate);
  const timelineViewportWidth = Math.max(0, container.clientWidth - leftColumnWidth);
  const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
  return Math.max(0, Math.min(maxScroll, position - timelineViewportWidth / 2));
}

/** Columns one Shift+arrow step moves, per view (a week, ~a month, a year, a year, five years). */
const LARGE_TIMELINE_STEP_UNITS: Partial<Record<ViewMode, number>> = {
  [ViewMode.DAY]: 7,
  [ViewMode.WEEK]: 4,
  [ViewMode.MONTH]: 12,
  [ViewMode.QUARTER]: 4,
  [ViewMode.YEAR]: 5,
};

/**
 * Scroll position after moving the timeline by whole periods (columns), for
 * the arrow-key shortcuts. Every view has equally wide columns, so stepping by
 * the column width is exact; the former scroll → date → next date → scroll
 * round trip rounded back into the same period at column boundaries, so every
 * other key press barely moved and the end of the range was out of reach
 * (#906).
 */
export function getTimelineScrollLeftAfterStep(
  scrollLeft: number,
  maxScrollLeft: number,
  viewMode: ViewMode,
  direction: -1 | 1,
  large = false,
): number {
  const units = large ? LARGE_TIMELINE_STEP_UNITS[viewMode] ?? 1 : 1;
  const next = scrollLeft + direction * units * getGanttUnitWidth(viewMode);
  return Math.max(0, Math.min(Math.max(0, maxScrollLeft), next));
}

export function getPrimaryTouch(event: TouchEvent): Touch | null {
  return event.touches[0] ?? event.changedTouches[0] ?? null;
}

export interface SyntheticMousePoint {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

export function toSyntheticMousePoint(touch: Touch): SyntheticMousePoint {
  return {
    clientX: touch.clientX,
    clientY: touch.clientY,
    screenX: touch.screenX,
    screenY: touch.screenY,
  };
}

export function dispatchSyntheticMouseEvent(
  target: EventTarget,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  point: SyntheticMousePoint,
): void {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: point.clientX,
    clientY: point.clientY,
    screenX: point.screenX,
    screenY: point.screenY,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
  }));
}
