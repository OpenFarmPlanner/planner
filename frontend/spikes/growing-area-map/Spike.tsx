import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { createEditor, type EditorState, type Mode } from './editor';

const modes: ReadonlyArray<[Mode, string]> = [
  ['select', 'Select and pan'], ['vertices', 'Edit vertices'], ['move', 'Drag group'],
  ['rectangle', 'Draw rectangle'], ['polygon', 'Draw polygon'],
];

export function Spike() {
  const canvas = useRef<HTMLDivElement>(null);
  const editor = useRef<ReturnType<typeof createEditor>>(null);
  const [state, setState] = useState<EditorState>();
  const [coordinates, setCoordinates] = useState('');
  const [transform, setTransform] = useState({ east: '0', north: '0', degrees: '0', scale: '1' });
  const selectedShape = state?.shapes.find(shape => shape.id === state.selected);
  const beds = state?.shapes.filter(shape => shape.id.startsWith('bed-')).length ?? 0;

  useEffect(() => {
    if (!canvas.current) return;
    const current = createEditor(canvas.current, setState);
    editor.current = current;
    return () => current.dispose();
  }, []);

  return (
    <main>
      <header>
        <div>
          <h1>Growing area map prototype</h1>
          <p>Synthetic location · {beds} beds · Local metres · Geometry only</p>
        </div>
        <div className="actions">
          <Button onClick={() => editor.current?.fit()}>Fit location</Button>
          {state?.editing
            ? <Button variant="contained" onClick={() => editor.current?.keep()}>Keep preview</Button>
            : <Button variant="contained" onClick={() => editor.current?.start()}>Edit shapes</Button>}
        </div>
      </header>
      <div className="workspace">
        <section aria-label="Map preview">
          <div className="canvas" ref={canvas} tabIndex={0} aria-label="Synthetic growing area map" />
        </section>
        <section className="controls" aria-label="Shape controls">
          <label htmlFor="shape-choice">Selected shape</label>
          <select id="shape-choice" value={state?.selected ?? ''} onChange={event => {
            editor.current?.select(event.target.value);
            setCoordinates('');
          }}>
            {state?.shapes.map(shape => <option key={shape.id} value={shape.id}>{shape.label}</option>)}
          </select>
          <p className="selection" role="status" aria-live="polite">
            {selectedShape && <>{selectedShape.label} · {selectedShape.ring.length - 1} vertices</>}
          </p>
          <output aria-label="Stored vertices" className="vertices" tabIndex={0}>
            {selectedShape?.ring.slice(0, -1).map(point =>
              point.map(value => Number(value.toFixed(4))).join(', ')).join('\n')}
          </output>
          {state?.editing && (
            <>
              <div className="actions" role="group" aria-label="Map tool">
                {modes.map(([mode, name]) => (
                  <Button key={mode} aria-pressed={state.mode === mode}
                    variant={state.mode === mode ? 'contained' : 'outlined'}
                    onClick={() => editor.current?.setMode(mode)}>{name}</Button>
                ))}
              </div>
              <fieldset>
                <legend>Move, rotate or resize together</legend>
                <div className="dimensions">
                  {([
                    ['east', 'East (m)'], ['north', 'North (m)'],
                    ['degrees', 'Rotation (°)'], ['scale', 'Scale factor'],
                  ] as const).map(([key, label]) => (
                    <TextField key={key} label={label} size="small" type="number" value={transform[key]}
                      onChange={event => setTransform({ ...transform, [key]: event.target.value })} />
                  ))}
                </div>
                <Button onClick={() => editor.current?.transform({
                  east: Number(transform.east), north: Number(transform.north),
                  degrees: Number(transform.degrees), scale: Number(transform.scale),
                })}>Apply transform</Button>
              </fieldset>
              <fieldset>
                <legend>Draw or edit with coordinates</legend>
                <TextField fullWidth multiline minRows={2} label="One X,Y pair per line"
                  helperText="Use two opposite corners for rectangles or at least three points for polygons."
                  value={coordinates} onChange={event => setCoordinates(event.target.value)} />
                <div className="actions">
                  <Button onClick={() => editor.current?.applyCoordinates('vertices', coordinates)}>Set vertices</Button>
                  <Button onClick={() => editor.current?.applyCoordinates('rectangle', coordinates)}>Add rectangle</Button>
                  <Button onClick={() => editor.current?.applyCoordinates('polygon', coordinates)}>Add polygon</Button>
                </div>
              </fieldset>
              <div className="actions">
                <Button disabled={!state.undoAvailable} onClick={() => editor.current?.undo()}>Undo</Button>
                <Button onClick={() => editor.current?.cancel()}>Cancel editing</Button>
              </div>
            </>
          )}
          {state?.message && <Alert severity="warning">{state.message}</Alert>}
        </section>
      </div>
    </main>
  );
}
