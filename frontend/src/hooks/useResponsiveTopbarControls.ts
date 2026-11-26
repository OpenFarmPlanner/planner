import { useLayoutEffect, useRef, useState } from 'react';

function controlsWidth(element: HTMLElement | null): number {
  if (!element) return 0;
  const children = Array.from(element.children).filter(node => node.getBoundingClientRect().width > 0);
  const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
  return children.reduce((width, node) => width + node.getBoundingClientRect().width, 0)
    + Math.max(0, children.length - 1) * gap;
}

/** Measures the shared title controls against actual page actions and global controls. */
export function useResponsiveTopbarControls(enabled: boolean, compact: boolean, compactWidth: number) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const pageActionsRef = useRef<HTMLDivElement | null>(null);
  const globalControlsRef = useRef<HTMLDivElement | null>(null);
  const [wrapped, setWrapped] = useState(true);
  const [narrow, setNarrow] = useState(false);

  useLayoutEffect(() => {
    if (!enabled || !toolbarRef.current) return;
    const toolbar = toolbarRef.current;
    const measure = () => {
      setNarrow(toolbar.clientWidth < compactWidth);
      const style = getComputedStyle(toolbar);
      const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const navigationWidth = toolbar.firstElementChild?.tagName === 'BUTTON'
        ? toolbar.firstElementChild.getBoundingClientRect().width + gap : 0;
      // Include title help, group margins and breathing room between the groups.
      const required = (titleRef.current?.scrollWidth ?? 0) + 44 + navigationWidth
        + controlsWidth(controlsRef.current) + controlsWidth(pageActionsRef.current)
        + (globalControlsRef.current?.getBoundingClientRect().width ?? 0) + gap * 5;
      setWrapped(compact || required > toolbar.clientWidth - padding);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const node of [toolbar, titleRef.current, controlsRef.current, pageActionsRef.current, globalControlsRef.current]) {
      if (node) observer?.observe(node);
    }
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  });

  return { wrapped, narrow, toolbarRef, titleRef, controlsRef, pageActionsRef, globalControlsRef };
}
