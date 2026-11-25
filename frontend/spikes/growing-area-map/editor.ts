import Collection from 'ol/Collection.js';
import Feature from 'ol/Feature.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import type { Coordinate } from 'ol/coordinate.js';
import { getCenter } from 'ol/extent.js';
import Polygon from 'ol/geom/Polygon.js';
import Draw, { createBox } from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Snap from 'ol/interaction/Snap.js';
import Translate from 'ol/interaction/Translate.js';
import VectorLayer from 'ol/layer/Vector.js';
import Projection from 'ol/proj/Projection.js';
import { addProjection } from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';

export type Mode = 'select' | 'vertices' | 'move' | 'rectangle' | 'polygon';
type Shape = {
  id: string;
  label: string;
  parent: string | null;
  ring: Coordinate[];
};
type Transform = { east: number; north: number; degrees: number; scale: number };

export type EditorState = {
  shapes: Shape[];
  selected: string;
  editing: boolean;
  mode: Mode;
  undoAvailable: boolean;
  message: string;
};

function ringFromCorners([west, south]: Coordinate, [east, north]: Coordinate) {
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

function demoShapes(): Shape[] {
  return [
    { id: 'site', parent: null, label: 'Site', ring: ringFromCorners([0, 0], [100, 76]) },
    { id: 'parcel', parent: 'site', label: 'Parcel', ring: ringFromCorners([10, 8], [87, 67]) },
    ...Array.from({ length: 54 }, (_, index) => {
      const x = 15 + (index % 9) * 7.4;
      const y = 13 + Math.floor(index / 9) * 7.4;
      return {
        id: `bed-${index + 1}`, parent: 'parcel', label: `Bed ${index + 1}`,
        ring: ringFromCorners([x, y], [x + 5.2, y + 3.5]),
      };
    }),
  ];
}

const localMetres = new Projection({
  code: 'OFP:SPIKE-METRES', units: 'm', extent: [-1000, -1000, 1000, 1000],
});
addProjection(localMetres);

const styles = {
  area: new Style({ fill: new Fill({ color: '#dce9db88' }), stroke: new Stroke({ color: '#56765a', width: 1.5 }) }),
  bed: new Style({ fill: new Fill({ color: '#a0c5a7' }), stroke: new Stroke({ color: '#4d795c', width: 1.5 }) }),
  selected: new Style({ fill: new Fill({ color: '#f3c36caa' }), stroke: new Stroke({ color: '#804917', width: 2.5 }) }),
};

export function createEditor(target: HTMLElement, onChange: (state: EditorState) => void) {
  const source = new VectorSource<Feature<Polygon>>({ wrapX: false });
  const layer = new VectorLayer({
    source,
    style: feature => feature.getId() === selected ? styles.selected
      : feature.get('parent') === 'parcel' ? styles.bed : styles.area,
  });
  const view = new View({ projection: localMetres, center: [50, 38], resolution: 0.3, maxResolution: 2 });
  const map = new Map({ target, layers: [layer], view, controls: [] });
  let selected = 'parcel';
  let mode: Mode = 'select';
  let session: Shape[] | null = null;
  let beforeGesture: Shape[] = [];
  let history: Shape[][] = [];
  let serial = 0;
  let draw: Draw | undefined;
  let interaction: Draw | Modify | Translate | undefined;
  let snap: Snap | undefined;

  function insert(shape: Shape) {
    const feature = new Feature({ geometry: new Polygon([shape.ring]), parent: shape.parent, label: shape.label });
    feature.setId(shape.id);
    source.addFeature(feature);
  }

  function snapshot(): Shape[] {
    return source.getFeatures().map(feature => ({
      id: String(feature.getId()),
      label: feature.get('label') as string,
      parent: feature.get('parent') as string | null,
      ring: feature.getGeometry()!.getCoordinates()[0],
    })).sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true }));
  }

  function emit(message = '') {
    layer.changed();
    onChange({
      shapes: snapshot(), selected, editing: session !== null, mode,
      undoAvailable: history.length > 0, message,
    });
  }

  function restore(shapes: Shape[]) {
    source.clear();
    shapes.forEach(insert);
    if (!source.getFeatureById(selected)) selected = 'parcel';
  }

  function record(before: Shape[]) {
    history = [...history.slice(-19), before];
    emit();
  }

  function fit() {
    const extent = source.getExtent();
    if (extent) view.fit(extent, { padding: [20, 20, 20, 20] });
  }

  function descendants(id: string) {
    const group = new Set([id]);
    const queue = [id];
    while (queue.length > 0) {
      const parent = queue.pop();
      for (const feature of source.getFeatures()) {
        if (feature.get('parent') !== parent) continue;
        const child = String(feature.getId());
        if (!group.has(child)) {
          group.add(child);
          queue.push(child);
        }
      }
    }
    return source.getFeatures().filter(feature => group.has(String(feature.getId())));
  }

  function addShape(geometry: Polygon) {
    if (geometry.getArea() <= 0) {
      emit('Enter a shape with a positive area.');
      return;
    }
    const before = snapshot();
    const count = ++serial;
    selected = `sketch-${count}`;
    insert({ id: selected, label: `Sketch ${count}`, parent: 'parcel', ring: geometry.getCoordinates()[0] });
    record(before);
  }

  function setMode(next: Mode) {
    draw?.abortDrawing();
    if (interaction) map.removeInteraction(interaction);
    if (snap) map.removeInteraction(snap);
    draw = undefined;
    snap = undefined;
    interaction = undefined;
    mode = next;

    const selectedFeature = source.getFeatureById(selected);
    if (session && selectedFeature) {
      if (mode === 'vertices') {
        const modify = new Modify({ features: new Collection([selectedFeature]) });
        modify.on('modifystart', () => { beforeGesture = snapshot(); });
        modify.on('modifyend', () => { record(beforeGesture); });
        interaction = modify;
      } else if (mode === 'move') {
        const translate = new Translate({ features: new Collection(descendants(selected)) });
        translate.on('translatestart', () => { beforeGesture = snapshot(); });
        translate.on('translateend', () => { record(beforeGesture); });
        interaction = translate;
      } else if (mode === 'rectangle' || mode === 'polygon') {
        draw = mode === 'rectangle'
          ? new Draw({ type: 'Circle', geometryFunction: createBox(), stopClick: true })
          : new Draw({ type: 'Polygon', stopClick: true });
        draw.on('drawend', event => {
          const geometry = event.feature.getGeometry();
          if (geometry instanceof Polygon) addShape(geometry);
        });
        interaction = draw;
      }
    }
    if (interaction) {
      map.addInteraction(interaction);
      if (mode !== 'move') {
        // Interactions handle events in reverse order, so add Snap last.
        snap = new Snap({ source, pixelTolerance: 12 });
        map.addInteraction(snap);
      }
    }
    emit();
  }

  function select(id: string) {
    if (!source.getFeatureById(id)) return;
    selected = id;
    setMode(mode);
  }

  map.on('singleclick', event => {
    if (mode !== 'select') return;
    const candidates = map.getFeaturesAtPixel(event.pixel).filter(feature => feature instanceof Feature);
    const smallest = candidates.sort((left, right) =>
      (left.getGeometry() as Polygon).getArea() - (right.getGeometry() as Polygon).getArea()
    )[0];
    if (smallest) select(String(smallest.getId()));
  });

  restore(demoShapes());
  fit();
  emit();

  return {
    select,
    setMode,
    start() {
      session = snapshot();
      setMode('select');
    },
    cancel() {
      if (session) restore(session);
      session = null;
      history = [];
      setMode('select');
    },
    keep() {
      session = null;
      history = [];
      setMode('select');
    },
    undo() {
      const before = history.pop();
      if (before) restore(before);
      setMode(mode);
    },
    fit,
    transform({ east, north, degrees, scale }: Transform) {
      const anchorShape = source.getFeatureById(selected)?.getGeometry();
      if (!session || !anchorShape) return;
      if (![east, north, degrees, scale].every(Number.isFinite) || scale <= 0 || scale > 10) {
        emit('Enter finite values and a scale between 0 and 10.');
        return;
      }
      const before = snapshot();
      const anchor = getCenter(anchorShape.getExtent());
      for (const feature of descendants(selected)) {
        const polygon = feature.getGeometry()!;
        polygon.scale(scale, scale, anchor);
        polygon.rotate(degrees * Math.PI / 180, anchor);
        polygon.translate(east, north);
      }
      record(before);
    },
    applyCoordinates(kind: 'vertices' | 'rectangle' | 'polygon', input: string) {
      if (!session) return;
      const points = input.trim().split('\n').map(line => line.split(',').map(part => {
        const value = part.trim();
        return value ? Number(value) : NaN;
      }));
      const enoughPoints = kind === 'rectangle' ? points.length === 2 : points.length >= 3;
      if (!enoughPoints || points.length > 100 || points.some(point =>
        point.length !== 2 || point.some(value => !Number.isFinite(value) || Math.abs(value) > 1000)
      )) {
        emit('Enter finite X,Y pairs on separate lines within the local grid.');
        return;
      }
      const ring = kind === 'rectangle'
        ? ringFromCorners(points[0], points[1]) : [...points, points[0]];
      const geometry = new Polygon([ring]);
      if (kind !== 'vertices') {
        addShape(geometry);
        return;
      }
      const feature = source.getFeatureById(selected);
      if (!feature || geometry.getArea() <= 0) {
        emit('Enter a shape with a positive area.');
        return;
      }
      const before = snapshot();
      feature.setGeometry(geometry);
      record(before);
    },
    dispose() {
      draw?.abortDrawing();
      map.dispose();
    },
  };
}
