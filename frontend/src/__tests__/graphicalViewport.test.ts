import { describe, expect, it } from 'vitest';
import {
  GRAPHICAL_MAX_SCALE,
  GRAPHICAL_MANUAL_MIN_SCALE,
  BED_LABEL_MIN_SCALE,
  clampViewportToStage,
  fitBoundsToStage,
  fitContentToStage,
  getContentBoundsFromRects,
  getVisibleElements,
  panViewport,
  shouldShowBedLabel,
  shouldShowFieldLabel,
  getFieldLabelScreenWidth,
  startPanSession,
  ZOOM_LEVEL_DETAIL,
  ZOOM_LEVEL_MEDIUM,
  ZOOM_LEVEL_OVERVIEW,
  zoomAroundPoint,
} from '../pages/graphicalViewport';

describe('graphicalViewport helpers', () => {
  it('derives visible elements from zoom level', () => {
    expect(getVisibleElements(ZOOM_LEVEL_OVERVIEW - 0.1)).toEqual({
      showBeds: false,
      showBedLabels: false,
      showDetailedBedLabels: false,
    });
    expect(getVisibleElements(ZOOM_LEVEL_MEDIUM)).toEqual({
      showBeds: true,
      showBedLabels: true,
      showDetailedBedLabels: false,
    });
    expect(getVisibleElements(ZOOM_LEVEL_DETAIL)).toEqual({
      showBeds: true,
      showBedLabels: true,
      showDetailedBedLabels: true,
    });
  });

  it('shows labels when the bed occupies enough screen pixels', () => {
    expect(shouldShowFieldLabel({ width: 150, height: 80 }, 1)).toBe(true);
    expect(shouldShowFieldLabel({ width: 30, height: 20 }, 1)).toBe(false);
    expect(shouldShowBedLabel({ width: 120, height: 50 }, ZOOM_LEVEL_DETAIL)).toBe(true);
    expect(shouldShowBedLabel({ width: 60, height: 20 }, ZOOM_LEVEL_DETAIL)).toBe(true);
    expect(shouldShowBedLabel({ width: 120, height: 50 }, ZOOM_LEVEL_OVERVIEW)).toBe(true);
    expect(shouldShowBedLabel({ width: 80, height: 28 }, BED_LABEL_MIN_SCALE - 0.05)).toBe(true);
  });

  it('shows a field label whenever the field is large enough on screen, at any zoom (#904)', () => {
    // A 6 m x 42 m field (108 x 756 world px) fitted at 0.44x: 47 px wide on screen.
    expect(shouldShowFieldLabel({ width: 108, height: 756 }, 0.44)).toBe(true);
    expect(shouldShowFieldLabel({ width: 108, height: 756 }, 0.3)).toBe(false);
    expect(shouldShowFieldLabel({ width: 2000, height: 1000 }, 0.05)).toBe(true);
    expect(getFieldLabelScreenWidth({ width: 108, height: 756 }, 0.5)).toBe(42);
    expect(getFieldLabelScreenWidth({ width: 10, height: 10 }, 0.5)).toBe(0);
  });

  it('shows bed labels at maximum zoom even for moderately sized beds', () => {
    expect(shouldShowBedLabel({ width: 28, height: 14 }, GRAPHICAL_MAX_SCALE)).toBe(true);
  });

  it('keeps bed labels hidden when beds are truly too small to render any text', () => {
    expect(shouldShowBedLabel({ width: 6, height: 4 }, GRAPHICAL_MAX_SCALE)).toBe(false);
  });

  it('fits content into the available stage size', () => {
    const viewport = fitContentToStage({ width: 1200, height: 900 }, { width: 400, height: 300 }, 20);
    expect(viewport.scale).toBeGreaterThan(0);
    expect(Number.isFinite(viewport.x)).toBe(true);
    expect(Number.isFinite(viewport.y)).toBe(true);
  });

  it('fits a few elements by using the content bounding box', () => {
    const bounds = getContentBoundsFromRects([
      { x: 120, y: 80, width: 220, height: 160 },
      { x: 430, y: 140, width: 110, height: 80 },
    ]);
    expect(bounds).not.toBeNull();
    const viewport = fitBoundsToStage(bounds!, { width: 1000, height: 800 }, 24);
    expect(viewport.scale).toBeGreaterThan(1);
    expect(viewport.x).toBeLessThan(0);
    expect(viewport.y).toBeLessThan(100);
  });

  it('fits many distributed elements without using the whole virtual canvas', () => {
    const bounds = getContentBoundsFromRects([
      { x: 20, y: 40, width: 140, height: 100 },
      { x: 780, y: 640, width: 180, height: 140 },
      { x: 420, y: 260, width: 120, height: 90 },
      { x: 1120, y: 120, width: 160, height: 110 },
      { x: 1500, y: 920, width: 130, height: 130 },
    ]);
    expect(bounds).not.toBeNull();
    const viewport = fitBoundsToStage(bounds!, { width: 900, height: 700 }, 20);
    expect(viewport.scale).toBeLessThan(1);
    expect(viewport.scale).toBeGreaterThan(0);
  });

  it('fits content with a large spread and allows fit scale below manual zoom minimum', () => {
    const bounds = getContentBoundsFromRects([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 7000, y: 5000, width: 200, height: 200 },
    ]);
    expect(bounds).not.toBeNull();
    const viewport = fitBoundsToStage(bounds!, { width: 1200, height: 800 }, 20);
    expect(viewport.scale).toBeLessThan(GRAPHICAL_MANUAL_MIN_SCALE);
    expect(viewport.scale).toBeGreaterThan(0);
  });

  it('recomputes fit from persisted layout bounds', () => {
    const defaultBounds = getContentBoundsFromRects([
      { x: 20, y: 20, width: 300, height: 200 },
    ]);
    const persistedBounds = getContentBoundsFromRects([
      { x: 420, y: 260, width: 300, height: 200 },
    ]);
    expect(defaultBounds).not.toBeNull();
    expect(persistedBounds).not.toBeNull();

    const initialViewport = fitBoundsToStage(defaultBounds!, { width: 1000, height: 800 }, 24);
    const persistedViewport = fitBoundsToStage(persistedBounds!, { width: 1000, height: 800 }, 24);
    expect(persistedViewport.x).not.toBe(initialViewport.x);
    expect(persistedViewport.y).not.toBe(initialViewport.y);
  });

  it('honors asymmetric fit padding (for right-side overlay controls)', () => {
    const bounds = getContentBoundsFromRects([
      { x: 0, y: 0, width: 600, height: 300 },
    ]);
    expect(bounds).not.toBeNull();
    const symmetricViewport = fitBoundsToStage(bounds!, { width: 1000, height: 700 }, 24);
    const asymmetricViewport = fitBoundsToStage(bounds!, { width: 1000, height: 700 }, {
      top: 24,
      right: 120,
      bottom: 24,
      left: 24,
    });
    expect(asymmetricViewport.scale).toBeLessThan(symmetricViewport.scale);
    expect(asymmetricViewport.x + 600 * asymmetricViewport.scale).toBeLessThanOrEqual(880.1);
  });

  it('keeps panning stable across multiple move events', () => {
    const initialViewport = { x: 120, y: 80, scale: 1.6 };
    const panSession = startPanSession(initialViewport, { x: 300, y: 200 });

    expect(panViewport(panSession, { x: 340, y: 245 }, initialViewport.scale)).toEqual({
      x: 160,
      y: 125,
      scale: 1.6,
    });
    expect(panViewport(panSession, { x: 365, y: 260 }, initialViewport.scale)).toEqual({
      x: 185,
      y: 140,
      scale: 1.6,
    });
  });

  it('preserves the zoom factor while panning at non-default scale', () => {
    const initialViewport = { x: -40, y: 30, scale: 2.25 };
    const panSession = startPanSession(initialViewport, { x: 100, y: 120 });

    expect(panViewport(panSession, { x: 160, y: 150 }, initialViewport.scale)).toEqual({
      x: 20,
      y: 60,
      scale: 2.25,
    });
  });

  it('clamps viewport so content cannot be panned beyond stage edges', () => {
    const clamped = clampViewportToStage(
      { x: 120, y: -900, scale: 1.5 },
      { width: 1000, height: 900 },
      { width: 600, height: 400 },
    );
    expect(clamped.x).toBeCloseTo(0);
    expect(clamped.y).toBe(-900);
  });

  it('centers content when scaled content is smaller than stage', () => {
    const centered = clampViewportToStage(
      { x: -100, y: -50, scale: 0.5 },
      { width: 600, height: 400 },
      { width: 800, height: 600 },
    );
    expect(centered.x).toBe(250);
    expect(centered.y).toBe(200);
  });

  it('keeps manual zoom clamped to the normal minimum zoom level', () => {
    const initial = { x: 0, y: 0, scale: 1 };
    const zoomed = zoomAroundPoint(initial, 0.05, { x: 100, y: 100 });
    expect(zoomed.scale).toBe(GRAPHICAL_MANUAL_MIN_SCALE);
  });
});
