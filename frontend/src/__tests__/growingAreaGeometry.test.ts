import {
  calculateMetricCoverage, footprintUnionArea, neighborGap, validateAreaGeometry, type MetricRect,
} from '../components/hierarchy/utils/growingAreaGeometry';

const rect = (x: number, y: number, width: number, height: number): MetricRect => ({ x, y, width, height });
const footprint = (id: number, shape: MetricRect | null) => ({ id, rect: shape });
const parent = rect(0, 0, 10, 10);

describe('growing-area metric geometry', () => {
  it('counts the union once and only subtracts footprints inside the parent', () => {
    const a = rect(-1, 0, 7, 10);
    const b = rect(4, 0, 5, 10);
    expect(footprintUnionArea([a, b])).toBe(100);
    expect(calculateMetricCoverage(parent, [footprint(1, a), footprint(2, b)])).toEqual({
      grossArea: 100, footprintArea: 90, remainingArea: 10,
    });
    expect(calculateMetricCoverage(parent, [])).toEqual({ grossArea: 100, footprintArea: 0, remainingArea: 100 });
  });

  it('distinguishes boundary overflow, overlap and a measured short gap', () => {
    const result = validateAreaGeometry(parent, [
      footprint(1, rect(0, 0, 4, 5)),
      footprint(2, rect(3, 0, 3, 5)),
      footprint(3, rect(6.2, 0, 4, 5)),
    ], 0.3);
    expect(result.issues).toEqual([
      { kind: 'outside', id: 3 },
      { kind: 'overlap', ids: [1, 2] },
      { kind: 'shortGap', ids: [2, 3], gapM: expect.closeTo(0.2), recommendedM: 0.3 },
    ]);
    expect(result.coverage.remainingArea).toBeCloseTo(51);
  });

  it('checks opposing edges rather than corners and accepts a measured gap at the recommendation', () => {
    const first = rect(0, 0, 4, 4);
    expect(neighborGap(first, rect(4.2, 4.2, 2, 2))).toBeNull();
    expect(neighborGap(first, rect(0.2, 4.25, 2, 2))).toBeCloseTo(0.25);
    expect(validateAreaGeometry(parent, [footprint(1, first), footprint(2, rect(4.3, 0, 4, 4))], 0.3).issues)
      .toEqual([]);
  });

  it('reports complete coverage and allows touching beds for a zero recommendation', () => {
    const footprints = [footprint(1, rect(0, 0, 5, 10)), footprint(2, rect(5, 0, 5, 10))];
    const result = validateAreaGeometry(parent, footprints, 0.3);
    expect(result.coverage).toEqual({ grossArea: 100, footprintArea: 100, remainingArea: 0 });
    expect(result.issues).toEqual([
      { kind: 'shortGap', ids: [1, 2], gapM: 0, recommendedM: 0.3 },
      { kind: 'noPathSpace' },
    ]);
    expect(validateAreaGeometry(parent, footprints, 0).issues).toEqual([]);
  });

  it('keeps partial coverage distinct from gaps and reports missing footprint dimensions', () => {
    const measured = footprint(1, rect(0, 0, 9.9, 10));
    expect(validateAreaGeometry(parent, [measured], 0.3).issues).toEqual([]);
    expect(validateAreaGeometry(parent, [measured, footprint(2, null)], 0.3)).toEqual({
      issues: [], coverage: { grossArea: 100, footprintArea: null, remainingArea: null }, uncertainIds: [2],
    });
    expect(validateAreaGeometry(null, [measured, footprint(2, rect(9.95, 0, 2, 3))], 0.3).issues)
      .toEqual([{ kind: 'shortGap', ids: [1, 2], gapM: expect.closeTo(0.05), recommendedM: 0.3 }]);
  });

  it('partitions free geometry with the same union and clipping as the area figures', () => {
    const footprints = [footprint(1, rect(-1, 2, 6, 6)), footprint(2, rect(3, 5, 6, 6))];
    const coverage = calculateMetricCoverage(parent, footprints, true);
    expect(coverage).toMatchObject({ grossArea: 100, footprintArea: 54, remainingArea: 46 });
    const free = coverage.freeRects!;
    expect(footprintUnionArea(free)).toBe(coverage.remainingArea);
    expect(free.reduce((area, shape) => area + shape.width * shape.height, 0)).toBe(coverage.remainingArea);
    for (const shape of free) {
      expect(shape.x).toBeGreaterThanOrEqual(0);
      expect(shape.y).toBeGreaterThanOrEqual(0);
      expect(shape.x + shape.width).toBeLessThanOrEqual(10);
      expect(shape.y + shape.height).toBeLessThanOrEqual(10);
    }
  });

  it('returns a single free shape for an empty measured site and no shapes for incomplete geometry', () => {
    expect(calculateMetricCoverage(parent, [], true).freeRects).toEqual([parent]);
    expect(calculateMetricCoverage(null, [], true).freeRects).toBeNull();
    expect(calculateMetricCoverage(parent, [footprint(1, null)], true).freeRects).toBeNull();
  });
});
