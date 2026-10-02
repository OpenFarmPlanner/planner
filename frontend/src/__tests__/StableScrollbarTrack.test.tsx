import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { StableScrollbarTrack } from '../components/data-grid/StableScrollbarTrack';
import type { StableDataGridScrollbar } from '../components/data-grid/hooks/useStableDataGridScrollbar';
import theme from '../theme';

interface RenderOptions {
  isActive?: boolean;
  thumbHeight?: number;
  top?: number | string;
  bottom?: number | string;
  right?: number | string;
  withRight?: boolean;
}

const renderTrack = ({
  isActive = true,
  thumbHeight = 64,
  top = 48,
  bottom = 12,
  right,
  withRight = right !== undefined,
}: RenderOptions = {}) => {
  const onThumbPointerDown = vi.fn();
  const onTrackPointerDown = vi.fn();
  const scrollbar: StableDataGridScrollbar = {
    isActive,
    thumbHeight,
    onThumbPointerDown,
    onTrackPointerDown,
  };
  const trackRef = createRef<HTMLDivElement>();
  const thumbRef = createRef<HTMLDivElement>();
  const view = render(
    <ThemeProvider theme={theme}>
      <StableScrollbarTrack
        trackRef={trackRef}
        thumbRef={thumbRef}
        scrollbar={scrollbar}
        top={top}
        bottom={bottom}
        {...(withRight ? { right } : {})}
        trackTestId="grid-scrollbar-track"
        thumbTestId="grid-scrollbar-thumb"
      />
    </ThemeProvider>,
  );
  return { ...view, onThumbPointerDown, onTrackPointerDown, trackRef, thumbRef };
};

const track = (): HTMLElement => screen.getByTestId('grid-scrollbar-track');
const thumb = (): HTMLElement => screen.getByTestId('grid-scrollbar-thumb');

/**
 * The track/thumb overlay for `useStableDataGridScrollbar`. The hook owns the
 * geometry and the drag maths and has its own suite; this component is the
 * markup both grids share so neither drifts from the other, and the one thing
 * it computes itself is CSS: three position props that each accept a number or
 * a string.
 *
 * Those conversions turn out to be redundant, which is worth recording. A
 * mutation battery over this file leaves exactly four breaks standing, and all
 * four replace a `typeof x === 'number' ? \`${x}px\` : x` with the raw value:
 * emotion appends `px` to a bare number for any property not on its unitless
 * list, and `top`, `bottom`, `right` and `height` are all off that list. The
 * component's own conversion is therefore belt-and-braces rather than something
 * the rendered CSS depends on -- the values are still asserted below, since
 * what matters is that they reach CSS at all.
 */
describe('StableScrollbarTrack', () => {
  describe('being active', () => {
    /** The hook reports inactive when the content fits; drawing a dead track over it would swallow clicks. */
    it('renders nothing while the scrollbar is inactive', () => {
      renderTrack({ isActive: false });
      expect(screen.queryByTestId('grid-scrollbar-track')).not.toBeInTheDocument();
      expect(screen.queryByTestId('grid-scrollbar-thumb')).not.toBeInTheDocument();
    });

    it('renders both parts once it is active', () => {
      renderTrack({ isActive: true });
      expect(track()).toBeInTheDocument();
      expect(thumb()).toBeInTheDocument();
    });

    it('nests the thumb inside the track', () => {
      renderTrack();
      expect(track().contains(thumb())).toBe(true);
    });
  });

  describe('positioning', () => {
    it('turns numeric offsets into pixels', () => {
      renderTrack({ top: 48, bottom: 12, right: 7 });
      const style = window.getComputedStyle(track());
      expect(style.top).toBe('48px');
      expect(style.bottom).toBe('12px');
      expect(style.right).toBe('7px');
    });

    /**
     * A content-fit table measures its own edge and passes a `calc()`. jsdom
     * resolves `rem` against the root font size, so `2rem` comes back as 32px
     * -- what matters is that the value reached CSS rather than being dropped.
     */
    it('passes a string offset through untouched', () => {
      renderTrack({ top: '2rem', bottom: '50%', right: 'calc(50% - 400px)' });
      const style = window.getComputedStyle(track());
      expect(style.top).toBe('32px');
      expect(style.bottom).toBe('50%');
      expect(style.right).toBe('calc(50% - 400px)');
    });

    it('treats a zero offset as a position, not as absent', () => {
      renderTrack({ top: 0, bottom: 0, right: 0 });
      const style = window.getComputedStyle(track());
      expect(style.top).toBe('0px');
      expect(style.bottom).toBe('0px');
      expect(style.right).toBe('0px');
    });

    it('sits flush with its positioned ancestor when no right offset is given', () => {
      renderTrack({ withRight: false });
      expect(window.getComputedStyle(track()).right).toBe('0px');
    });

    it('is positioned absolutely, so it overlays the grid rather than displacing it', () => {
      renderTrack();
      expect(window.getComputedStyle(track()).position).toBe('absolute');
      expect(window.getComputedStyle(thumb()).position).toBe('absolute');
    });

    /** Above the grid's own sticky header, which the hierarchy grid raises. */
    it('stacks above the grid content', () => {
      renderTrack();
      expect(window.getComputedStyle(track()).zIndex).toBe('60');
    });

    it('keeps the track narrow', () => {
      renderTrack();
      expect(window.getComputedStyle(track()).width).toBe('10px');
    });
  });

  describe('the thumb', () => {
    it('takes its height from the hook', () => {
      renderTrack({ thumbHeight: 64 });
      expect(window.getComputedStyle(thumb()).height).toBe('64px');
    });

    it('follows a changed height', () => {
      renderTrack({ thumbHeight: 120 });
      expect(window.getComputedStyle(thumb()).height).toBe('120px');
    });

    /**
     * `top: 0` is deliberate: the hook writes the vertical position as a
     * transform on every scroll frame, so a `top` the component controlled
     * would fight it.
     */
    it('starts at the top of the track and leaves the rest to the hook', () => {
      renderTrack();
      const style = window.getComputedStyle(thumb());
      expect(style.top).toBe('0px');
      expect(style.transform).toBe('none');
    });

    it('insets itself inside the track on both sides', () => {
      renderTrack();
      const style = window.getComputedStyle(thumb());
      expect(style.left).toBe('2px');
      expect(style.right).toBe('2px');
    });

    it('is visible against the grid', () => {
      renderTrack();
      expect(window.getComputedStyle(thumb()).backgroundColor).toBe('rgba(0, 0, 0, 0.3)');
    });

    it('invites dragging', () => {
      renderTrack();
      expect(window.getComputedStyle(thumb()).cursor).toBe('pointer');
    });
  });

  describe('handing pointer events to the hook', () => {
    it('reports a press on the thumb', () => {
      const { onThumbPointerDown } = renderTrack();
      fireEvent.pointerDown(thumb());
      expect(onThumbPointerDown).toHaveBeenCalledTimes(1);
    });

    /**
     * A press on the bare track pages the grid, which is a different gesture
     * from dragging the thumb. Telling the two apart is the hook's job, not
     * this component's: the real `onThumbPointerDown` calls
     * `stopPropagation`, and the real `onTrackPointerDown` additionally
     * returns early unless `event.target` is the track itself. With mocked
     * handlers neither guard exists, so a thumb press does reach both -- which
     * says nothing about the component and is why this asserts only that the
     * event's target is the thumb, the fact the hook's own check relies on.
     */
    it('leaves a thumb press targeted at the thumb, not the track', () => {
      const { onThumbPointerDown } = renderTrack();
      fireEvent.pointerDown(thumb());
      expect(onThumbPointerDown.mock.calls[0]?.[0].target).toBe(thumb());
    });

    it('reports a press on the track, and not as a thumb press', () => {
      const { onThumbPointerDown, onTrackPointerDown } = renderTrack();
      fireEvent.pointerDown(track());
      expect(onTrackPointerDown).toHaveBeenCalledTimes(1);
      expect(onThumbPointerDown).not.toHaveBeenCalled();
      expect(onTrackPointerDown.mock.calls[0]?.[0].target).toBe(track());
    });
  });

  describe('handing its elements to the hook', () => {
    /**
     * The hook moves the thumb by writing to the node directly rather than
     * through a React render, so both refs have to reach the rendered elements
     * or the thumb never moves.
     */
    it('attaches both refs', () => {
      const { trackRef, thumbRef } = renderTrack();
      expect(trackRef.current).toBe(track());
      expect(thumbRef.current).toBe(thumb());
    });

    it('leaves the refs empty while inactive', () => {
      const { trackRef, thumbRef } = renderTrack({ isActive: false });
      expect(trackRef.current).toBeNull();
      expect(thumbRef.current).toBeNull();
    });

    it('renders without test ids when the caller passes none', () => {
      const scrollbar: StableDataGridScrollbar = {
        isActive: true,
        thumbHeight: 40,
        onThumbPointerDown: vi.fn(),
        onTrackPointerDown: vi.fn(),
      };
      const trackRef = createRef<HTMLDivElement>();
      render(
        <ThemeProvider theme={theme}>
          <StableScrollbarTrack
            trackRef={trackRef}
            thumbRef={createRef<HTMLDivElement>()}
            scrollbar={scrollbar}
            top={0}
            bottom={0}
          />
        </ThemeProvider>,
      );
      expect(trackRef.current).not.toBeNull();
      expect(trackRef.current).not.toHaveAttribute('data-testid');
    });
  });
});
