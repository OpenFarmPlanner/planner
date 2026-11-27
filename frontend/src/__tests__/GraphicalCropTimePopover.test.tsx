import { useState } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GraphicalCropTimePopover } from '../pages/GraphicalCropTimePopover';

it.each(['light', 'dark'] as const)('keeps the projected interval visible during invalid edits in the %s palette', mode => {
  const select = vi.fn();
  const theme = createTheme({ palette: { mode } });
  function CropTime() {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    return <>
      <button onClick={event => setAnchor(event.currentTarget)}>Kulturdaten</button>
      <GraphicalCropTimePopover id="crop-time" anchor={anchor} onClose={() => setAnchor(null)}
        season={{ id: 1, start_date: '2026-01-01', end_date: '2026-12-31' }}
        reference={{ kind: 'range', start: '2026-03-05', end: '2026-03-10' }} onSelect={select} />
    </>;
  }
  render(<ThemeProvider theme={theme}><CropTime /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Kulturdaten' }));

  const from = screen.getByLabelText('Von');
  const to = screen.getByLabelText('Bis');
  fireEvent.change(to, { target: { value: '2026-03-04' } });
  expect(from).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Das Enddatum darf nicht vor dem Startdatum liegen.');
  expect(screen.getByText('Gezeigter Zeitraum: 5.3.2026 bis 10.3.2026')).toBeVisible();
  expect(select).not.toHaveBeenCalled();

  fireEvent.change(to, { target: { value: '2026-03-05' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(select).toHaveBeenCalledWith({ kind: 'range', start: '2026-03-05', end: '2026-03-05' });
});
