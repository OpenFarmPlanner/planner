/**
 * Column widths are tuned for the German and English header titles. French
 * and Spanish titles are often longer, and a fixed width cuts them off behind
 * the sort arrow. These helpers widen a column only when its title needs
 * more room than the base width already gives it, so the German and English
 * layouts keep their exact widths.
 */

/** Approximate width of one character of a bold header title. */
const HEADER_CHAR_WIDTH_PX = 8;

export interface ColumnHeaderWidthOptions {
  /** The width the column has when its title fits. */
  baseWidth: number;
  /** Room the header needs beside the title: cell padding, icons, sort arrow. */
  allowance: number;
  /** Upper bound, so a very long title never squeezes the other columns out. */
  maxWidth: number;
}

/** Width a column needs so that the longest of `titles` is not cut off. */
export function widthForHeaderTitles(titles: readonly string[], options: ColumnHeaderWidthOptions): number {
  const longest = titles.reduce((length, title) => Math.max(length, title.length), 0);
  const needed = longest * HEADER_CHAR_WIDTH_PX + options.allowance;
  return Math.max(options.baseWidth, Math.min(options.maxWidth, needed));
}
