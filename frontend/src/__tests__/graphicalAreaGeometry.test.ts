import type { Bed, Field, Location, LocationLayoutsResponse } from '../api/types';
import { alpha, createTheme } from '@mui/material/styles';
import { freeAreaColor } from '../components/hierarchy/utils/freeAreaColors';
import { defaultLocationPathSpacing } from '../components/hierarchy/utils/locationPathSpacing';
import { analyzeGraphicalGeometry, getGraphicalBedLayout, getSavedLocationCoverage, getSavedParcelCoverage, getSchematicFieldSize, getSchematicLocationLayout } from '../pages/graphicalAreaGeometry';
import { rotateRect, rotateRectBetweenSizes, type GraphicalRotation } from '../pages/graphicalLayoutUtils';
import { canvasToStem, stemToCanvas } from '../pages/individualPlantGeometry';

const location: Location = { id: 1, name: 'Farm', width_m: 30, length_m: 30 };
const field: Field = { id: 1, name: 'Plot', location: 1, width_m: 10, length_m: 10 };
const beds: Bed[] = [{ id: 2, field: 1, name: 'Bed', width_m: 2, length_m: 3 }];
const canvas = { width: 540, height: 540 };
const parcel = { id: 1, x: 20, y: 20, width: 180, height: 180, supportsMetricSpacing: true };
const boundary = { x: 0, y: 0, ...canvas };

describe('graphical layout analysis', () => {
  it.each<GraphicalRotation>([0, 90, 180, 270])('keeps fractional parcel gaps consistent with snapping at %s degrees', rotation => {
    const first = { ...field, width_m: 10.02, length_m: 9.05 };
    const second = { ...first, id: 2 };
    const size = getSchematicFieldSize(first);
    expect(size.width).toBeCloseTo(180.36);
    const parcels = [first, second].map((plot, index) => ({
      field: plot,
      rect: rotateRect({ id: index + 1, x: 20 + index * (size.width + 0.75 * 18), y: 20,
        ...size, supportsMetricSpacing: true }, canvas, rotation),
      layout: getGraphicalBedLayout(plot, [], {}, rotation),
    }));
    const result = analyzeGraphicalGeometry(location, rotateRect(boundary, canvas, rotation), parcels,
      defaultLocationPathSpacing, rotation, null);
    expect(result.locationReport.uncertainIds).toEqual([]);
    expect(result.locationReport.issues).toEqual([]);
  });

  it.each<GraphicalRotation>([0, 90, 180, 270])('keeps an overflowing saved bed visible and measures it at %s degrees', rotation => {
    const layout = getGraphicalBedLayout(field, beds, {
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
    const layout = getGraphicalBedLayout(field, beds, layouts, 0);
    const graph = analyzeGraphicalGeometry(location, boundary, [{ field, rect: parcel, layout }],
      defaultLocationPathSpacing, 0, { type: 'bed', id: 2, locationId: 1, position: { x: 20, y: 0 } });
    expect(graph.parcelReports.get(1)?.issues).toEqual([]);
    expect(graph.parcelReports.get(1)?.coverage.remainingArea).toBeCloseTo(94);
    expect(layout.bedRects[0].x / layout.pixelsPerMeter!.x)
      .toBeCloseTo(layouts[2].x / layout.storedPixelsPerMeter!.x);
    expect(layouts[2].x).toBe(144);
  });

  it.each<GraphicalRotation>([0, 90, 180, 270])('shares the site scale and round-trips old bed coordinates at %s degrees', rotation => {
    const narrow = { ...field, width_m: 3, length_m: 12 };
    const broad = { ...field, id: 3, width_m: 18, length_m: 7 };
    const approximate = { ...field, id: 4, length_m: null };
    const stored = { bed: 2, location: 1, x: 13, y: 63, version: 1 };
    const scene = getSchematicLocationLayout(location, [narrow, broad, approximate], {}, { x: 0, y: 0 }, rotation, 1440, 900);
    const quarterTurn = rotation % 180 !== 0;
    expect(scene.boundary).toMatchObject({ width: 540, height: 540 });
    expect(scene.fieldViewModels[0]).toMatchObject({
      width: quarterTurn ? 216 : 54, height: quarterTurn ? 54 : 216, supportsMetricSpacing: true,
    });
    expect(scene.fieldViewModels[1]).toMatchObject({
      width: quarterTurn ? 126 : 324, height: quarterTurn ? 324 : 126, supportsMetricSpacing: true,
    });
    expect(scene.fieldViewModels[2].supportsMetricSpacing).toBe(false);
    for (const plot of [narrow, broad, approximate]) {
      const layout = getGraphicalBedLayout(plot, beds, { 2: stored }, rotation);
      const bed = layout.bedRects[0];
      const fieldRect = scene.fieldViewModels.find(rect => rect.id === plot.id)!;
      expect(layout.usableArea).toEqual({ x: 0, y: 0, width: fieldRect.width, height: fieldRect.height });
      expect(bed).toMatchObject({ width: quarterTurn ? 54 : 36, height: quarterTurn ? 36 : 54 });
      const roundTrip = rotateRectBetweenSizes(bed, layout.usableArea, layout.storedUsableArea,
        ((360 - rotation) % 360) as GraphicalRotation);
      expect(roundTrip.x).toBeCloseTo(stored.x);
      expect(roundTrip.y).toBeCloseTo(stored.y);
    }
  });

  it('keeps metre offsets in the bed’s own axes when it runs across a parcel', () => {
    const layout = getGraphicalBedLayout(field, beds, {
      2: { bed: 2, location: 1, x: 23, y: 47, runs_across_parcel: true },
    }, 90);
    const surface = layout.bedRects[0];
    const stem = { x_m: 0.5, y_m: 2 };
    expect(surface).toMatchObject({ width: 36, height: 54, placementRotation: 180 });
    const point = stemToCanvas(stem, beds[0], surface, surface.placementRotation)!;
    expect(point.x - surface.x).toBeCloseTo(27);
    expect(point.y - surface.y).toBeCloseTo(18);
    expect(canvasToStem(point, beds[0], surface, surface.placementRotation)).toEqual(stem);
  });
});

describe('saved coverage for detail pages', () => {
  it('counts the clipped parcel union and distinguishes unsaved position and empty coverage', () => {
    const fields = [field, { ...field, id: 2 }, { ...field, id: 3 }];
    const layouts: LocationLayoutsResponse = {
      location_boundary: { x: 0, y: 0 }, bed_layouts: [],
      field_layouts: [
        { field: 1, location: 1, x: 0, y: 0 },
        { field: 2, location: 1, x: 90, y: 0 },
        { field: 3, location: 1, x: 522, y: 522 },
      ],
    };
    expect(getSavedLocationCoverage(location, fields, layouts)).toEqual({ grossArea: 900, footprintArea: 151, remainingArea: 749 });
    expect(getSavedLocationCoverage(location, fields, { ...layouts, field_layouts: [] }))
      .toEqual({ grossArea: 900, footprintArea: null, remainingArea: null });
    expect(getSavedLocationCoverage(location, [], layouts)).toEqual({ grossArea: 900, footprintArea: 0, remainingArea: 900 });
  });

  it('decodes the saved coordinates and applies the same physical clipping as the canvas', () => {
    const bedLayout = { bed: 2, location: 1, x: 144, y: 0 };
    const coverage = getSavedParcelCoverage(field, beds, { field_layouts: [], bed_layouts: [bedLayout] });
    expect(coverage.footprintArea).toBeCloseTo(3);
    expect(coverage.remainingArea).toBeCloseTo(97);
    expect(getSavedParcelCoverage(field, [{ ...beds[0], width_m: null }], { field_layouts: [], bed_layouts: [] }))
      .toEqual({ grossArea: 100, footprintArea: null, remainingArea: null });
  });

  it('keeps a saved parcel beyond the original workspace outside the location on every viewport', () => {
    const saved = { field: 1, location: 1, x: 6000, y: 6000 };
    const expandedLocation = { ...location, width_m: 300, length_m: 300 };
    const origin = { x: 0, y: 0 };
    for (const [width, height] of [[375, 600], [1440, 900]]) {
      const canvasLayout = getSchematicLocationLayout(expandedLocation, [field], { 1: saved }, origin, 0, width, height);
      expect(canvasLayout.fieldViewModels[0]).toMatchObject({ x: saved.x, y: saved.y });
    }
    expect(getSavedLocationCoverage(expandedLocation, [field], {
      field_layouts: [saved], bed_layouts: [], location_boundary: origin,
    })).toEqual({ grossArea: 90000, footprintArea: 0, remainingArea: 90000 });
  });

  it.each(['light', 'dark'] as const)('uses the %s theme colors for the legend and rendering', mode => {
    const theme = createTheme({ palette: { mode } });
    expect(freeAreaColor(theme, 'site')).toBe(alpha(theme.palette.info.main, 0.12));
    expect(freeAreaColor(theme, 'parcel')).toBe(alpha(theme.palette.success.main, 0.16));
  });
});
