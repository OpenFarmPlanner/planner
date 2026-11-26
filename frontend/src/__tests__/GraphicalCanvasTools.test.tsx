import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { GraphicalCanvasTools } from '../pages/GraphicalCanvasTools';

const labels = {
  more: 'Weitere Grafikwerkzeuge',
  plants: 'Einzelpflanzen',
  zoom: 'Hineinzoomen',
  rotation: 'Ansicht um 90° nach rechts drehen',
};

describe('GraphicalCanvasTools', () => {
  it.each(['light', 'dark'] as const)('keeps the core and warning tools when there is no eligible overflow action (%s)', mode => {
    const onZoom = vi.fn();
    render(<ThemeProvider theme={createTheme({ palette: { mode } })}>
      <GraphicalCanvasTools width={1500} height={900} fullscreen onZoom={onZoom}
        onFit={vi.fn()} onFullscreen={vi.fn()} onRotate={vi.fn()} onPan={vi.fn()}
        onTriggerChange={vi.fn()} warnings={<button aria-label="Layoutwarnung" />} />
    </ThemeProvider>);
    expect(screen.queryByRole('button', { name: labels.more })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.plants })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.rotation })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Layoutwarnung' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: labels.zoom }));
    expect(onZoom).toHaveBeenCalledWith(1);
  });

  it('promotes the only eligible action and retains the trigger node as actions regroup', () => {
    const toggle = vi.fn();
    const onTriggerChange = vi.fn();
    const shared = { height: 900, fullscreen: false, onZoom: vi.fn(), onFit: vi.fn(),
      onFullscreen: vi.fn(), onRotate: vi.fn(), onPan: vi.fn(), onTriggerChange, warnings: null };
    const { rerender } = render(<GraphicalCanvasTools {...shared} width={1500}
      individualPlants={{ active: true, toggle }} />);
    const direct = screen.getByRole('button', { name: labels.plants, pressed: true });
    expect(onTriggerChange).toHaveBeenLastCalledWith(direct);
    expect(screen.queryByRole('button', { name: labels.more })).not.toBeInTheDocument();
    fireEvent.click(direct);
    expect(toggle).toHaveBeenCalledTimes(1);

    direct.focus();
    rerender(<GraphicalCanvasTools {...shared} width={800} individualPlants={{ active: true, toggle }} />);
    const more = screen.getByRole('button', { name: labels.more, expanded: false });
    expect(more).toBe(direct);
    expect(more).toHaveFocus();
    expect(screen.queryByRole('button', { name: labels.plants })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.rotation })).not.toBeInTheDocument();
  });
});
