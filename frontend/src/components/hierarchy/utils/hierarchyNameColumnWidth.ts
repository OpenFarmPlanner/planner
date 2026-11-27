import type { TFunction } from 'i18next';
import type { ColumnText } from '../../data-grid/gridContentWidths';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../../../utils/numberLocalization';
import type { HierarchyRow } from './types';

export const HIERARCHY_NAME_INDENT_PX = 24;
export const HIERARCHY_EXPAND_SLOT_PX = 32;
export const HIERARCHY_EXPAND_MARGIN_PX = 8;
export const HIERARCHY_NAME_GAP_PX = 4;
export const HIERARCHY_TOUCH_ACTION_PX = 40;

export const getHierarchyNameTextOffsetPx = (level: number) =>
  level * HIERARCHY_NAME_INDENT_PX + HIERARCHY_EXPAND_SLOT_PX + HIERARCHY_EXPAND_MARGIN_PX;

export function hierarchyNameText(row: HierarchyRow, value: unknown, t: TFunction, showInlineCount: boolean) {
  const count = row.individualPlantCount;
  const pending = row.individualPendingCount;
  const countLabel = row.type === 'individualPlan' && showInlineCount && count !== undefined
    ? t('fields:individualPlants.count', { count, formatted: formatLocalizedNumber(count, getActiveFormattingLocale()) }) : '';
  const pendingLabel = pending ? t('fields:individualPlants.pendingCount', {
    count: pending, formatted: formatLocalizedNumber(pending, getActiveFormattingLocale()),
  }) : '';
  return [String(value ?? ''), countLabel, pendingLabel].filter(Boolean).join(' · ');
}

/** The width occupied by the in-flow hover/focus controls, including their gaps. */
function rowActionsWidth(row: HierarchyRow): number {
  const more = 30;
  const button = 26;
  const gap = 4;
  const margin = 4;
  if (row.type === 'individualPlan') return more + margin;
  if (row.type === 'bed' && row.bedId === undefined) return more + margin;
  const hasDelete = (row.type === 'location' && row.locationId !== undefined)
    || (row.type === 'field' && row.fieldId !== undefined) || row.type === 'bed';
  return more + margin + (button + gap) * (hasDelete ? 2 : 1);
}

export function measureHierarchyName(row: HierarchyRow, t: TFunction, touch: boolean, showInlineCount: boolean): ColumnText {
  const leading = row.type === 'individualPlan' ? 24 : 0;
  const labelPadding = row.type === 'bed' ? 8 : 0;
  return {
    text: hierarchyNameText(row, row.name, t, showInlineCount),
    extra: getHierarchyNameTextOffsetPx(row.level) + HIERARCHY_NAME_GAP_PX + leading + labelPadding
      + (touch ? HIERARCHY_TOUCH_ACTION_PX : rowActionsWidth(row)),
    fontSize: row.type === 'location' ? 16.32 : row.type === 'bed' ? 15.2 : 16,
    fontWeight: row.type === 'location' ? 600 : 400,
  };
}
