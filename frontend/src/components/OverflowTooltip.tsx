import {
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type FocusEventHandler,
  type MouseEvent,
  type MouseEventHandler,
  type ReactElement,
  type Ref,
} from 'react';
import type { TooltipProps } from '@mui/material';
import { unstable_useForkRef as useForkRef } from '@mui/utils';
import { AppTooltip } from './AppTooltip';

type OverflowTooltipChild = ReactElement<{
  ref?: Ref<HTMLElement>;
  onBlur?: FocusEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onMouseEnter?: MouseEventHandler<HTMLElement>;
  onMouseLeave?: MouseEventHandler<HTMLElement>;
}>;

export interface OverflowTooltipProps
  extends Pick<TooltipProps, 'arrow' | 'placement' | 'enterDelay' | 'slotProps'> {
  children: OverflowTooltipChild;
  title: string;
  focusWithinColumnHeader?: boolean;
}

const isFinePointer = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
};

const isElementOverflowing = (element: HTMLElement): boolean =>
  element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;

export function OverflowTooltip({
  children,
  title,
  arrow,
  placement,
  enterDelay,
  slotProps,
  focusWithinColumnHeader = false,
}: OverflowTooltipProps) {
  const [activeElement, setActiveElement] = useState<HTMLElement | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [headerFocused, setHeaderFocused] = useState(false);
  const labelRef = useRef<HTMLElement>(null);
  const ref = useForkRef(children.props.ref, focusWithinColumnHeader ? labelRef : null);

  const updateTooltipVisibility = useCallback((element: HTMLElement | null = activeElement): void => {
    setShowTooltip(Boolean(title) && Boolean(element && isElementOverflowing(element)));
  }, [activeElement, title]);

  useEffect(() => {
    if (!activeElement || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => updateTooltipVisibility(activeElement));
    observer.observe(activeElement);
    return () => observer.disconnect();
  }, [activeElement, updateTooltipVisibility]);

  useEffect(() => {
    if (!focusWithinColumnHeader) return;
    const label = labelRef.current;
    const header = label?.closest('[role="columnheader"]');
    if (!header || !label) return;
    const onFocus = () => {
      if (!header.matches(':focus-visible')) return;
      setHeaderFocused(true);
      setActiveElement(label);
      updateTooltipVisibility(label);
    };
    const onBlur = () => {
      setHeaderFocused(false);
      setActiveElement(null);
    };
    header.addEventListener('focus', onFocus);
    header.addEventListener('blur', onBlur);
    return () => {
      header.removeEventListener('focus', onFocus);
      header.removeEventListener('blur', onBlur);
    };
  }, [focusWithinColumnHeader, updateTooltipVisibility]);

  const open = showTooltip && (headerFocused || (isActive && isFinePointer()));
  return (
    <AppTooltip
      open={open}
      title={open ? title : ''}
      isEligible={element => Boolean(title) && isElementOverflowing(element)}
      arrow={arrow}
      placement={placement}
      enterDelay={enterDelay}
      slotProps={slotProps}
      disableTouchListener
    >
      {cloneElement(children, {
        ...(ref ? { ref } : {}),
        onBlur: (event: FocusEvent<HTMLElement>) => {
          setIsActive(false);
          if (!headerFocused) setActiveElement(null);
          children.props.onBlur?.(event);
        },
        onFocus: (event: FocusEvent<HTMLElement>) => {
          setActiveElement(event.currentTarget);
          setIsActive(true);
          updateTooltipVisibility(event.currentTarget);
          children.props.onFocus?.(event);
        },
        onMouseEnter: (event: MouseEvent<HTMLElement>) => {
          setActiveElement(event.currentTarget);
          setIsActive(true);
          updateTooltipVisibility(event.currentTarget);
          children.props.onMouseEnter?.(event);
        },
        onMouseLeave: (event: MouseEvent<HTMLElement>) => {
          setIsActive(false);
          if (!headerFocused) setActiveElement(null);
          children.props.onMouseLeave?.(event);
        },
      })}
    </AppTooltip>
  );
}
