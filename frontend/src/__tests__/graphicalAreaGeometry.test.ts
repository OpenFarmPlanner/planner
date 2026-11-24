import type { Bed, Field, Location } from '../api/types';
import { defaultLocationPathSpacing } from '../components/hierarchy/utils/locationPathSpacing';
import { analyzeGraphicalGeometry, getGraphicalBedLayout } from '../pages/graphicalAreaGeometry';
import { rotateRect, type GraphicalRotation } from '../pages/graphicalLayoutUtils';

const location: Location = { id: 1, name: 'Farm', width_m: 30, length_m: 30 };
const field: Field = { id: 1, name: 'Plot', location: 1, width_m: 10, length_m: 10 };
const beds: Bed[] = [{ id: 2, field: 1, name: 'Bed', width_m: 2, length_m: 3 }];
const canvas = { width: 540, height: 540 };
const parcel = { id: 1, x: 20, y: 20, width: 180, height: 180, supportsMetricSpacing: true };
const boundary = { x: 0, y: 0, ...canvas };

describe('graphical layout analysis', () => {
  it.each<GraphicalRotation>([0, 90, 180, 270])('keeps an overflowing saved bed visible and measures it at %s degrees', rotation => {
    const layout = getGraphicalBedLayout(field, parcel, beds, {
      2: { bed: 2, location: 1, x: 144, y: 0, version: 1 },
    }, rotation);
    const graph = analyzeGraphicalGeometry(location, rotateRect(boundary, canvas, rotation), [
      { field, rect: rotateRect(parcel, canvas, rotation), layout },
    ], defaultLocationPathSpacing, rotation, null);
    const report = graph.parcelReports.get(1)!;
    expect(report.issues).toEqual([{ kind: 'outside', id: 2 }]);
    expect(report.coverage.footprintArea).toBeCloseTo(3);
    expect(report.coverage.remainingArea).toBeCloseTo(97);
    expect(graph.locationReport.issues).toEqual([]);
  });

  it('replaces a bed position in the preview without changing the saved layout or moving its parcel', () => {
    const layouts = { 2: { bed: 2, location: 1, x: 144, y: 0, version: 1 } };
    const layout = getGraphicalBedLayout(field, parcel, beds, layouts, 0);
    const graph = analyzeGraphicalGeometry(location, boundary, [{ field, rect: parcel, layout }],
      defaultLocationPathSpacing, 0, { type: 'bed', id: 2, locationId: 1, position: { x: 20, y: 0 } });
    expect(graph.parcelReports.get(1)?.issues).toEqual([]);
    expect(graph.parcelReports.get(1)?.coverage.remainingArea).toBeCloseTo(94);
    expect(layout.bedRects[0].x).toBe(144);
    expect(layouts[2].x).toBe(144);
  });
});
