import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';

/**
 * Layout of a detail-page header: a title column beside `DetailPageActions`.
 *
 * The actions stay beside the title as long as the title's longest word fits
 * there; multi-word titles wrap between words next to them. Only when a single
 * word is too wide for the space left of the actions do they move to a row of
 * their own below the title, so a name like "Buschbohne" is never broken
 * mid-word to keep the buttons pinned.
 *
 * How: the row may wrap, and the title column's flex basis is its
 * `min-content` width (its longest word), so the line breaks exactly when that
 * word plus the actions no longer fit. The title text therefore must not use
 * `overflowWrap: 'anywhere'`, which would shrink that width to one letter.
 * `minWidth: 0` still lets the column shrink below the word when the word is
 * wider than the whole header, so it breaks instead of overflowing.
 *
 * Desktop and tablet only: the phone headers render a single-line title
 * selector and keep their own non-wrapping layout.
 */
export const detailHeaderRowSx: SystemStyleObject<Theme> = {
  display: 'flex',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
};

export const detailHeaderTitleColumnSx: SystemStyleObject<Theme> = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 'min-content',
  minWidth: 0,
};

/** Breaks a word only when it is wider than the whole header on its own. */
export const detailHeaderTitleTextSx: SystemStyleObject<Theme> = {
  overflowWrap: 'break-word',
};
