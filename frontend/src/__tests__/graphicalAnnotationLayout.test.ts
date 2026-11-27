import { describe, expect, it } from 'vitest';
import { layoutAreaAnnotations, type AreaAnnotationSubject } from '../pages/graphicalAnnotationLayout';
import { rectsOverlap, type Rect } from '../pages/graphicalLayoutUtils';

const viewport = { width: 400, height: 300 };
const subject = (footprint: Rect, options: Partial<AreaAnnotationSubject> = {}): AreaAnnotationSubject => ({
  key: 'field:1', testId: 'field-label-1', kind: 'field', text: 'North plot', textWidth: 54, footprint, gaps: [], ...options,
});

describe('growing-area annotations', () => {
  it('uses an unobstructed interior and follows panning without resizing the text or the plot', () => {
    const footprint = { x: 90, y: 70, width: 150, height: 110 };
    const plot = subject(Object.freeze(footprint));
    const [initial] = layoutAreaAnnotations([plot], [], viewport);
    expect(initial).toMatchObject({ placement: 'inside', rect: { x: 96, y: 76, width: 67, height: 20 } });
    const [panned] = layoutAreaAnnotations([subject({ ...footprint, x: 105, y: 80 })], [], viewport);
    expect(panned.rect).toEqual({ ...initial.rect, x: 111, y: 86 });
    const [zoomed] = layoutAreaAnnotations([subject({ x: 80, y: 60, width: 200, height: 160 })], [], viewport);
    expect(zoomed.rect).toEqual({ ...initial.rect, x: 86, y: 66 });
    expect(plot.footprint).toEqual({ x: 90, y: 70, width: 150, height: 110 });
  });

  it('uses measured free space between beds when the ordinary interior candidates are occupied', () => {
    const footprint = { x: 80, y: 50, width: 220, height: 190 };
    const gap = { x: 80, y: 94, width: 220, height: 36 };
    const beds = [{ x: 80, y: 50, width: 220, height: 44 }, { x: 80, y: 130, width: 220, height: 110 }];
    const [label] = layoutAreaAnnotations([subject(footprint, { gaps: [gap] })], beds.map(rect => ({ rect })), viewport);
    expect(label).toMatchObject({ placement: 'gap', rect: { x: 84, y: 98 } });
    expect(beds.every(bed => !rectsOverlap(label.rect, bed))).toBe(true);
  });

  it('places a packed parcel just outside with a short leader starting at its true boundary', () => {
    const footprint = { x: 100, y: 90, width: 100, height: 100 };
    const [label] = layoutAreaAnnotations([subject(footprint)], [{ rect: footprint }], viewport);
    expect(label).toMatchObject({ placement: 'outside', leader: [{ x: 150, y: 90 }, { x: 150, y: 81 }] });
    expect(rectsOverlap(label.rect, footprint)).toBe(false);
  });

  it('suppresses crowded neighbors and names that cannot fit whole or have no visible footprint', () => {
    const left = { x: 0, y: 0, width: 85, height: 70 };
    const right = { x: 85, y: 0, width: 85, height: 70 };
    const crowded = [subject(left), subject(right, { key: 'field:2' })];
    expect(layoutAreaAnnotations(crowded, [{ rect: left }, { rect: right }], { width: 170, height: 70 })).toEqual([]);
    const translated = subject({ x: 90, y: 60, width: 130, height: 90 }, {
      text: 'Äußerst langes Gewächshaus · 도시 농업 연구소의 두 번째 밭', textWidth: 395,
    });
    expect(layoutAreaAnnotations([translated], [], viewport)).toEqual([]);
    expect(layoutAreaAnnotations([subject({ x: 395, y: 20, width: 3, height: 100 })], [], viewport)).toEqual([]);
  });

  it('avoids markers, controls and other area names with deterministic location priority', () => {
    const footprint = { x: 75, y: 56, width: 235, height: 143 };
    const field = subject(footprint);
    const location = subject({ x: 37, y: 27, width: 330, height: 235 }, { key: 'location:1', kind: 'location' });
    const control = { x: 36, y: 24, width: 120, height: 38 };
    const marker = { x: 80, y: 64, width: 16, height: 16 };
    const obstacles = [{ rect: footprint, owner: field.key }, { rect: control }, { rect: marker }];
    const placements = layoutAreaAnnotations([field, location], obstacles, viewport);
    expect(placements.map(label => label.subject.key)).toEqual([location.key, field.key]);
    expect(placements.every(({ rect }) => !rectsOverlap(rect, control) && !rectsOverlap(rect, marker))).toBe(true);
    expect(rectsOverlap(placements[0].rect, placements[1].rect)).toBe(false);
    expect(layoutAreaAnnotations([location, field], obstacles, viewport)).toEqual(placements);
  });
});
