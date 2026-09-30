import { useEffect, useState } from 'react';

const APP_BAR_SELECTOR = 'header.MuiAppBar-root';

/**
 * Current height of the sticky app bar, so page-level sticky rows can sit
 * directly beneath it. The bar's height varies (a second action row appears
 * on some pages and widths), hence measured rather than hard-coded.
 */
export function useAppBarHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const appBar = document.querySelector<HTMLElement>(APP_BAR_SELECTOR);
    if (!appBar) {
      return undefined;
    }
    const update = (): void => setHeight(appBar.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(update);
    observer.observe(appBar);
    return () => observer.disconnect();
  }, []);

  return height;
}
