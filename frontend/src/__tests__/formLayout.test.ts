import { describe, expect, it } from 'vitest';
import {
  compactFieldSx,
  formRowSx,
  fullWidthFieldSx,
  mediumFieldSx,
  mediumStackedFieldSx,
  smallFieldSx,
  wideFieldSx,
  wideSingleColumnFieldSx,
  wideStackedFieldSx,
} from '../components/forms/formLayout';

describe('form layout widths', () => {
  it.each([
    ['compact', compactFieldSx, 180],
    ['small', smallFieldSx, 224],
    ['medium', mediumFieldSx, 300],
    ['wide', wideFieldSx, 400],
  ])('keeps %s fields fluid on mobile and bounded on larger screens', (_name, sx, desktopWidth) => {
    expect(sx.width).toEqual({ xs: '100%', sm: desktopWidth });
    expect(sx.maxWidth).toEqual({ xs: '100%', sm: desktopWidth });
    expect(sx.flex).toEqual({ xs: '1 1 100%', sm: `0 1 ${desktopWidth}px` });
  });

  it.each([
    ['mediumStacked', mediumStackedFieldSx],
    ['wideSingleColumn', wideSingleColumnFieldSx],
    ['wideStacked', wideStackedFieldSx],
  ])('keeps %s fields free of a flex-basis that would become a height in a column', (_name, sx) => {
    expect(sx).not.toHaveProperty('flex');
    expect(sx).not.toHaveProperty('flexBasis');
    expect(sx).not.toHaveProperty('height');
    expect(sx).not.toHaveProperty('minHeight');
  });

  it.each([
    ['compact', compactFieldSx],
    ['small', smallFieldSx],
    ['medium', mediumFieldSx],
    ['wide', wideFieldSx],
    ['mediumStacked', mediumStackedFieldSx],
    ['wideSingleColumn', wideSingleColumnFieldSx],
    ['wideStacked', wideStackedFieldSx],
    ['fullWidth', fullWidthFieldSx],
  ])('lets the %s field input stretch instead of shrink-wrapping to the browser\'s intrinsic input width', (_name, sx) => {
    expect(sx).not.toHaveProperty('alignItems');
  });

  it('keeps prose fields full width and allows compact rows to wrap', () => {
    expect(fullWidthFieldSx.width).toBe('100%');
    expect(formRowSx.flexWrap).toBe('wrap');
  });
});
