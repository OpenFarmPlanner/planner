import {
  FIELD_INNER_BOTTOM_PADDING,
  FIELD_INNER_OFFSET_X,
  FIELD_INNER_OFFSET_Y,
  FIELD_SNAP_THRESHOLD,
  MOBILE_VIEWPORT_CONTROL_SAFE_AREA_RIGHT,
  MOBILE_VIEWPORT_PADDING,
  SNAP_THRESHOLD,
  VIEWPORT_CONTROL_SAFE_AREA_RIGHT,
  VIEWPORT_PADDING,
  getFieldUsableArea,
  getFitViewportPadding,
  snapToNeighbors,
  type RectViewModel,
} from '../pages/graphicalFieldsGeometry';

const rect = (id: number, x: number, y: number, width = 100, height = 60): RectViewModel =>
  ({ id, x, y, width, height });

const snap = (
  position: { x: number; y: number },
  neighbors: RectViewModel[],
  threshold?: number,
) => snapToNeighbors(1, position, { width: 100, height: 60 }, neighbors, { thresholdPx: threshold });

describe('getFitViewportPadding', () => {
  it('uses the desktop padding and control safe area on a wide stage', () => {
    expect(getFitViewportPadding(1440)).toEqual({
      top: 62,
      right: VIEWPORT_PADDING + VIEWPORT_CONTROL_SAFE_AREA_RIGHT,
      bottom: 48,
      left: VIEWPORT_PADDING,
    });
  });

  it('switches to the tighter mobile padding below 600px', () => {
    expect(getFitViewportPadding(375)).toEqual({
      top: 62,
      right: MOBILE_VIEWPORT_PADDING + MOBILE_VIEWPORT_CONTROL_SAFE_AREA_RIGHT,
      bottom: 48,
      left: MOBILE_VIEWPORT_PADDING,
    });
  });

  it('treats exactly 600px as desktop', () => {
    expect(getFitViewportPadding(600).left).toBe(VIEWPORT_PADDING);
    expect(getFitViewportPadding(599).left).toBe(MOBILE_VIEWPORT_PADDING);
  });

  it('always leaves more room on the right, where the controls sit', () => {
    for (const width of [375, 599, 600, 1440]) {
      const padding = getFitViewportPadding(width);
      expect(padding.right).toBeGreaterThan(padding.left);
    }
  });
});

describe('snapToNeighbors', () => {
  it('leaves the position alone when there is nothing to snap to', () => {
    expect(snap({ x: 200, y: 200 }, [])).toEqual({ x: 200, y: 200, guides: [] });
  });

  it('never snaps a rectangle to itself', () => {
    // The dragged rectangle is in the neighbour list; matching its own edges
    // would pin it in place and it could never be moved.
    const result = snapToNeighbors(
      1, { x: 203, y: 200 }, { width: 100, height: 60 }, [rect(1, 200, 200)],
    );

    expect(result).toEqual({ x: 203, y: 200, guides: [] });
  });

  it('aligns left edge to left edge', () => {
    const result = snap({ x: 203, y: 500 }, [rect(2, 200, 500)]);

    expect(result.x).toBe(200);
  });

  it('aligns the dragged right edge, not only its left edge', () => {
    // Dragged spans 305..405, neighbour spans 400..500. Only the dragged right
    // edge is near anything; its left edge is 95px away from every neighbour
    // point, so this can only pass if the right edge is a snap candidate.
    const result = snap({ x: 305, y: 900 }, [rect(2, 400, 500, 100, 60)]);

    expect(result.x).toBe(300);
  });

  it('aligns the dragged centre, not only its left edge', () => {
    // Dragged spans 700..800, centre 750, against a neighbour left edge at 755.
    // The dragged left edge is 55px away, so only the centre can match.
    const result = snap({ x: 700, y: 900 }, [rect(2, 755, 500, 400, 60)]);

    expect(result.x).toBe(705);
  });

  it('aligns an edge to a neighbour centre, not only to like edges', () => {
    // Neighbour spans 200..400, centre 300. A dragged left edge at 303 snaps
    // to that centre — this is what lets a bed line up under a field's middle.
    const result = snap({ x: 303, y: 900 }, [rect(2, 200, 900, 200, 60)]);

    expect(result.x).toBe(300);
  });

  it('snaps the vertical axis the same way', () => {
    const result = snap({ x: 900, y: 203 }, [rect(2, 900, 200)]);

    expect(result.y).toBe(200);
  });

  it('aligns the dragged bottom edge, not only its top edge', () => {
    // Dragged spans y 345..405 against a neighbour top edge at 400; the top
    // edge is 55px away, so only the bottom edge can match.
    const result = snap({ x: 900, y: 345 }, [rect(2, 500, 400, 100, 60)]);

    expect(result.y).toBe(340);
  });

  it('aligns the dragged vertical centre, not only its top edge', () => {
    // Dragged spans y 700..760, centre 730, against a neighbour top edge at
    // 735. Neither the top nor the bottom edge is within reach of it.
    const result = snap({ x: 900, y: 700 }, [rect(2, 500, 735, 100, 400)]);

    expect(result.y).toBe(705);
  });

  it('snaps both axes independently in one move', () => {
    const result = snap({ x: 203, y: 204 }, [rect(2, 200, 200)]);

    expect(result).toMatchObject({ x: 200, y: 200 });
  });

  it('leaves an axis alone when only the other one is close', () => {
    const result = snap({ x: 203, y: 900 }, [rect(2, 200, 200)]);

    expect(result.x).toBe(200);
    expect(result.y).toBe(900);
  });

  it('does not snap beyond the threshold', () => {
    // y is kept far from the neighbour so only the x axis is in play.
    const result = snap({ x: 200 + SNAP_THRESHOLD + 1, y: 900 }, [rect(2, 200, 500)]);

    expect(result.x).toBe(200 + SNAP_THRESHOLD + 1);
    expect(result.guides).toEqual([]);
  });

  it('snaps at exactly the threshold, on both axes', () => {
    expect(snap({ x: 200 + SNAP_THRESHOLD, y: 900 }, [rect(2, 200, 500)]).x).toBe(200);
    expect(snap({ x: 900, y: 200 + SNAP_THRESHOLD }, [rect(2, 500, 200)]).y).toBe(200);
  });

  it('accepts a wider threshold for fields, which are dragged coarsely', () => {
    const distance = FIELD_SNAP_THRESHOLD - 1;

    expect(snap({ x: 200 + distance, y: 500 }, [rect(2, 200, 500)]).x)
      .toBe(200 + distance);
    expect(snap({ x: 200 + distance, y: 500 }, [rect(2, 200, 500)], FIELD_SNAP_THRESHOLD).x)
      .toBe(200);
  });

  it('prefers the closer of two candidates', () => {
    // Left edges at 195 and 202 against a dragged left edge at 200.
    const result = snap({ x: 200, y: 500 }, [rect(2, 195, 500), rect(3, 202, 500)]);

    expect(result.x).toBe(202);
  });

  it('reports one guide per axis, not one per candidate edge', () => {
    const result = snap({ x: 203, y: 204 }, [rect(2, 200, 200), rect(3, 201, 201)]);

    expect(result.guides.filter((guide) => guide.orientation === 'vertical')).toHaveLength(1);
    expect(result.guides.filter((guide) => guide.orientation === 'horizontal')).toHaveLength(1);
  });

  it('draws the guide at the neighbour edge that was matched', () => {
    const result = snap({ x: 203, y: 500 }, [rect(2, 200, 500)]);
    const guide = result.guides.find((entry) => entry.orientation === 'vertical');

    expect(guide?.value).toBe(200);
  });

  it('spans the guide across both rectangles so the alignment is visible', () => {
    // Dragged spans y 500..560, neighbour spans y 700..760.
    const result = snap({ x: 203, y: 500 }, [rect(2, 200, 700)]);
    const guide = result.guides.find((entry) => entry.orientation === 'vertical');

    expect(guide?.start).toBe(500);
    expect(guide?.end).toBe(760);
  });

  it('spans a horizontal guide across the x extent of both', () => {
    const result = snap({ x: 500, y: 203 }, [rect(2, 700, 200)]);
    const guide = result.guides.find((entry) => entry.orientation === 'horizontal');

    expect(guide?.start).toBe(500);
    expect(guide?.end).toBe(800);
  });

  it('emits no guide for an axis that did not snap', () => {
    const result = snap({ x: 203, y: 900 }, [rect(2, 200, 200)]);

    expect(result.guides.map((guide) => guide.orientation)).toEqual(['vertical']);
  });

  it('keeps the position exact rather than nudging an already-aligned rectangle', () => {
    const result = snap({ x: 200, y: 200 }, [rect(2, 200, 200)]);

    expect(result).toMatchObject({ x: 200, y: 200 });
  });

  it('snaps to the exact edge gap on each axis and reports the measured distance', () => {
    const spacing = { centimeters: 30, pixelsPerMeter: { x: 20, y: 10 } };
    const neighbor = { ...rect(2, 200, 500), supportsMetricSpacing: true };
    const horizontally = snapToNeighbors(1, { x: 308, y: 505 }, { width: 100, height: 60 }, [neighbor], { spacing });
    expect(horizontally.x).toBe(306);
    expect(horizontally.guides).toContainEqual(expect.objectContaining({
      start: 300, end: 306, gapCm: 30, orientation: 'horizontal',
    }));
    const vertically = snapToNeighbors(1, { x: 205, y: 564 }, { width: 100, height: 60 }, [neighbor], { spacing });
    expect(vertically.y).toBe(563);
    expect(vertically.guides).toContainEqual(expect.objectContaining({
      start: 560, end: 563, gapCm: 30, orientation: 'vertical',
    }));
  });

  it('captures the same screen offset at different zoom levels', () => {
    const neighbor = { ...rect(2, 200, 500), supportsMetricSpacing: true };
    const spacing = { centimeters: 100, pixelsPerMeter: { x: 20, y: 20 } };
    for (const zoom of [0.5, 1, 2, 4]) {
      const result = (screenDistance: number) => snapToNeighbors(
        1, { x: 320 + screenDistance / zoom, y: 500 }, { width: 100, height: 60 }, [neighbor], { spacing, zoom },
      );
      expect(result(7).x).toBe(320);
      expect(result(9).x).toBe(320 + 9 / zoom);
    }
  });

  it('keeps a near-tie stable and chooses a reproducible target without prior selection', () => {
    const options = { spacing: { centimeters: 100, pixelsPerMeter: { x: 20, y: 20 } } };
    const neighbors = [rect(2, 200, 500), rect(3, 204, 500)]
      .map(neighbor => ({ ...neighbor, supportsMetricSpacing: true }));
    const size = { width: 100, height: 60 };
    const first = snapToNeighbors(1, { x: 322, y: 500 }, size, neighbors.toReversed(), options);
    expect(first.x).toBe(320);
    const previousTargets = first.guides.map(guide => guide.target);
    expect(snapToNeighbors(1, { x: 322.9, y: 500 }, size, neighbors, { ...options, previousTargets }).x).toBe(320);
    expect(snapToNeighbors(1, { x: 324, y: 500 }, size, neighbors, { ...options, previousTargets }).x).toBe(324);
  });

  it('does not invent gaps for unknown or perpendicular geometry or out-of-bounds positions', () => {
    const neighbor = { ...rect(2, 200, 500), supportsMetricSpacing: true };
    const spacing = { centimeters: 100, pixelsPerMeter: { x: 20, y: 20 } };
    const size = { width: 100, height: 60 };
    const position = { x: 323, y: 500 };
    expect(snapToNeighbors(1, position, size, [{ ...neighbor, supportsMetricSpacing: false }], { spacing }).x)
      .toBe(323);
    expect(snapToNeighbors(1, { ...position, y: 570 }, size, [neighbor], { spacing }).x).toBe(323);
    const constrained = snapToNeighbors(1, position, size, [neighbor], {
      spacing, constrain: point => ({ ...point, x: Math.max(322, point.x) }),
    });
    expect(constrained.x).toBe(323);
    expect(constrained.guides.every(guide => guide.gapCm === undefined)).toBe(true);
  });
});

describe('getFieldUsableArea', () => {
  it('keeps the border and the label strip free', () => {
    expect(getFieldUsableArea({ width: 560, height: 220 })).toEqual({
      x: FIELD_INNER_OFFSET_X,
      y: FIELD_INNER_OFFSET_Y,
      width: 560 - 2 * FIELD_INNER_OFFSET_X,
      height: 220 - FIELD_INNER_OFFSET_Y - FIELD_INNER_BOTTOM_PADDING,
    });
  });

  it('never reports a negative size for a field smaller than its margins', () => {
    expect(getFieldUsableArea({ width: 10, height: 20 })).toMatchObject({ width: 0, height: 0 });
  });
});
