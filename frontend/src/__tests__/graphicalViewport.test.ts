import { describe, expect, it } from 'vitest';
import {
  GRAPHICAL_MAX_SCALE,
  GRAPHICAL_MANUAL_MIN_SCALE,
  GRAPHICAL_APPROXIMATE_MAX_SCALE,
  BED_LABEL_MIN_SCALE,
  clampScale,
  clampViewportToStage,
  fitBoundsToStage,
  fitContentToStage,
  getContentBoundsFromRects,
  getMetricScaleBar,
  getZoomLimits,
  getVisibleElements,
  getBedLabelLayout,
  panViewport,
  rotateViewport,
  shouldShowBedLabel,
  startPanSession,
  ZOOM_LEVEL_DETAIL,
  ZOOM_LEVEL_MEDIUM,
  ZOOM_LEVEL_OVERVIEW,
  zoomAroundPoint,
} from '../pages/graphicalViewport';

describe('graphicalViewport helpers', () => {
  it('derives visible elements from zoom level', () => {
    expect(getVisibleElements(ZOOM_LEVEL_OVERVIEW - 0.1)).toEqual({
      showBeds: true,
      showBedLabels: true,
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
    expect(shouldShowBedLabel({ width: 120, height: 50 }, ZOOM_LEVEL_DETAIL)).toBe(true);
    expect(shouldShowBedLabel({ width: 60, height: 20 }, ZOOM_LEVEL_DETAIL)).toBe(true);
    expect(shouldShowBedLabel({ width: 120, height: 50 }, ZOOM_LEVEL_OVERVIEW)).toBe(true);
    expect(shouldShowBedLabel({ width: 80, height: 28 }, BED_LABEL_MIN_SCALE - 0.05)).toBe(true);
  });

  it('shows bed labels at maximum zoom even for moderately sized beds', () => {
    expect(shouldShowBedLabel({ width: 28, height: 14 }, GRAPHICAL_MAX_SCALE)).toBe(true);
  });

  it('keeps bed labels hidden when beds are truly too small to render any text', () => {
    expect(shouldShowBedLabel({ width: 0.6, height: 0.4 }, GRAPHICAL_MAX_SCALE)).toBe(false);
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

  it('keeps a large fitted site stable during a pan and allows zooming back out to fit', () => {
    const bounds = { minX: 72, minY: 38, maxX: 200_072, maxY: 30_038 };
    const stage = { width: 320, height: 420 };
    const padding = { left: 16, top: 62, right: 64, bottom: 52 };
    const overview = fitBoundsToStage(bounds, stage, padding);
    expect(overview.scale).toBeCloseTo(0.0012, 12);
    const limits = getZoomLimits(overview.scale, GRAPHICAL_MAX_SCALE);
    const pointer = { x: 120, y: 230 };
    const session = startPanSession(overview, pointer);
    const panned = panViewport(session, { x: 200, y: 300 }, overview.scale);
    const clamped = clampViewportToStage(panned, bounds, stage, padding);
    expect(clamped.x).toBeCloseTo(overview.x, 10);
    expect(clamped.y).toBeCloseTo(overview.y, 10);
    expect(clamped.scale).toBe(overview.scale);
    expect(zoomAroundPoint(overview, 0, pointer, limits)).toBe(overview);
    const zoomed = zoomAroundPoint(overview, overview.scale * 1.2, pointer, limits);
    expect(zoomed.scale).toBeCloseTo(overview.scale * 1.2);
    const returned = zoomAroundPoint(zoomed, 0, pointer, limits);
    expect(returned.scale).toBe(overview.scale);
    expect(returned.x).toBeCloseTo(overview.x, 10);
    expect(returned.y).toBeCloseTo(overview.y, 10);
  });

  it('uses the physical zoom ceiling for tiny measured areas and retains the schematic ceiling', () => {
    const bounds = { minX: 3000, minY: 4000, maxX: 3012, maxY: 4008 };
    const stage = { width: 900, height: 700 };
    expect(fitBoundsToStage(bounds, stage).scale * 18).toBeCloseTo(500, 12);
    expect(fitBoundsToStage(bounds, stage, 24, GRAPHICAL_APPROXIMATE_MAX_SCALE).scale).toBe(3);
    const limits = getZoomLimits(0.4, GRAPHICAL_MAX_SCALE);
    expect(clampScale(Infinity, limits)).toBe(GRAPHICAL_MAX_SCALE);
    expect(clampScale(NaN, limits)).toBe(GRAPHICAL_MANUAL_MIN_SCALE);
    expect(clampScale(limits.min * (1 + Number.EPSILON), limits)).toBe(limits.min);
  });

  it('keeps the world point under the pointer or moving pinch center through clamping', () => {
    const initial = { x: -230, y: -740, scale: 10 };
    const from = { x: 124, y: 280 };
    const to = { x: 186, y: 245 };
    const limits = getZoomLimits(0.1, GRAPHICAL_MAX_SCALE);
    const zoomed = zoomAroundPoint(initial, 40, from, limits, to);
    expect(zoomed.scale).toBe(GRAPHICAL_MAX_SCALE);
    expect((to.x - zoomed.x) / zoomed.scale).toBeCloseTo((from.x - initial.x) / initial.scale, 10);
    expect((to.y - zoomed.y) / zoomed.scale).toBeCloseTo((from.y - initial.y) / initial.scale, 10);
    expect(zoomAroundPoint(zoomed, 45, to, limits)).toBe(zoomed);
  });

  it('rotates the world point under the fitted view center without resetting zoom', () => {
    const viewport = { x: -30, y: -25, scale: 5 };
    const content = { width: 240, height: 320 };
    const stage = { width: 600, height: 500 };
    const padding = { left: 20, top: 50, right: 80, bottom: 30 };
    const rotated = rotateViewport(viewport, content, stage, 90, padding);
    expect(rotated).toEqual({ x: -1045, y: -40, scale: 5 });
    expect(rotateViewport(rotated, { width: 320, height: 240 }, stage, 270, padding)).toEqual(viewport);
  });

  it.each([
    { scale: 0.02, meters: 200, width: 72 },
    { scale: 1, meters: 5, width: 90 },
    { scale: 3, meters: 1, width: 54 },
    { scale: GRAPHICAL_MAX_SCALE, meters: 0.1, width: 50 },
  ])('chooses a metric bar of $meters m at scale $scale', ({ scale, meters, width }) => {
    expect(getMetricScaleBar(scale, 96)?.meters).toBeCloseTo(meters, 8);
    expect(getMetricScaleBar(scale, 96)?.width).toBeCloseTo(width, 8);
    expect(getMetricScaleBar(NaN, 96)).toBeNull();
  });
});


describe('bed label orientation', () => {
  it.each([0.1, 0.5, 1, 3])('keeps labels inside either orientation at zoom %s', scale => {
    for (const size of [{ width: 300, height: 2000 }, { width: 2000, height: 300 }]) {
      const label = getBedLabelLayout(size, scale)!;
      expect(label).not.toBeNull();
      expect(label.rotation).toBe(0);
      const x = label.x * scale;
      const y = label.y * scale;
      const bounds = { x, y, width: label.width, height: label.height };
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width * scale);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height * scale);
    }
  });
  it('requires enough screen space for a line and finite positive zoom', () => {
    expect(getBedLabelLayout({ width: 100, height: 12 }, 1)).toBeNull();
    expect(getBedLabelLayout({ width: 12, height: 100 }, 1)).toBeNull();
    expect(getBedLabelLayout({ width: 14, height: 80 }, 1)).toBeNull();
    expect(getBedLabelLayout({ width: 80, height: 14 }, 1)?.rotation).toBe(0);
    for (const scale of [0, -1, NaN, Infinity]) {
      expect(getBedLabelLayout({ width: 100, height: 100 }, scale)).toBeNull();
    }
  });
});
