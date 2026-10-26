import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { HarvestOverlap } from '../api/types';
import { HarvestOverlapAlert, HarvestOverlapIcon } from '../components/planting-plans/HarvestOverlapInfo';

const predecessorOverlaps: HarvestOverlap[] = [
  { role: 'predecessor', other_plan_id: 2, other_crop_label: 'Grünkohl', date: '2026-05-20' },
  { role: 'predecessor', other_plan_id: 3, other_crop_label: 'Salat', date: '2026-06-10' },
];

/** The allowed harvest overlaps: one info line per affected plan, never a warning. */
describe('HarvestOverlapInfo', () => {
  it('lists one line per follow-up crop on the previous crop', () => {
    render(<HarvestOverlapAlert overlaps={predecessorOverlaps} />);

    const alert = screen.getByTestId('harvest-overlap-alert');
    expect(alert.className).toMatch(/MuiAlert-(standard|color)Info/);
    expect(alert).toHaveTextContent('Ernte endet spätestens am 20.5.2026 (Folgekultur Grünkohl).');
    expect(alert).toHaveTextContent('Ernte endet spätestens am 10.6.2026 (Folgekultur Salat).');
  });

  it('names the previous crop and its planned harvest end on the follow-up crop', () => {
    render(<HarvestOverlapAlert overlaps={[
      { role: 'successor', other_plan_id: 1, other_crop_label: 'Salat', date: '2026-07-01' },
    ]} />);

    expect(screen.getByTestId('harvest-overlap-alert')).toHaveTextContent(
      'Wird während der Erntephase von Salat gesetzt (geplantes Ernteende 1.7.2026).',
    );
  });

  it('renders nothing without overlaps', () => {
    const { container } = render(
      <>
        <HarvestOverlapAlert overlaps={[]} />
        <HarvestOverlapIcon overlaps={undefined} />
      </>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the table icon with the lines as its tooltip', async () => {
    render(<HarvestOverlapIcon overlaps={predecessorOverlaps} />);

    const icon = screen.getByRole('img', { name: 'Ernteüberlappung' });
    await userEvent.hover(icon);

    expect(await screen.findByText('Ernte endet spätestens am 20.5.2026 (Folgekultur Grünkohl).')).toBeInTheDocument();
  });
});
