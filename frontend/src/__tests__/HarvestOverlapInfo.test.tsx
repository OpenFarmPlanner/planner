import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { HarvestOverlap } from '../api/types';
import {
  HarvestOverlapAlert,
  HarvestOverlapDateCell,
  HarvestOverlapIcon,
} from '../components/planting-plans/HarvestOverlapInfo';

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
    expect(alert).toHaveTextContent('Grünkohl folgt ab 20.5.2026 auf diesem Beet. Die Ernte muss bis dahin abgeschlossen sein.');
    expect(alert).toHaveTextContent('Salat folgt ab 10.6.2026 auf diesem Beet. Die Ernte muss bis dahin abgeschlossen sein.');
  });

  it('names the previous crop and its planned harvest end on the follow-up crop', () => {
    render(<HarvestOverlapAlert overlaps={[
      { role: 'successor', other_plan_id: 1, other_crop_label: 'Salat', date: '2026-07-01' },
    ]} />);

    expect(screen.getByTestId('harvest-overlap-alert')).toHaveTextContent(
      'Beginnt vor dem geplanten Ernteende von Salat (1.7.2026).',
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

    expect(await screen.findByText('Grünkohl folgt ab 20.5.2026 auf diesem Beet. Die Ernte muss bis dahin abgeschlossen sein.')).toBeInTheDocument();
  });

  it('marks the table date of a previous crop and shows the lines on hover', async () => {
    render(<HarvestOverlapDateCell overlaps={predecessorOverlaps} cellHasFocus={false}>9.6.2026</HarvestOverlapDateCell>);

    await userEvent.hover(screen.getByTestId('harvest-overlap-date'));

    expect(await screen.findByText('Salat folgt ab 10.6.2026 auf diesem Beet. Die Ernte muss bis dahin abgeschlossen sein.')).toBeInTheDocument();
  });

  it('leaves the table date of a follow-up crop unmarked', () => {
    render(<HarvestOverlapDateCell overlaps={[
      { role: 'successor', other_plan_id: 1, other_crop_label: 'Salat', date: '2026-07-01' },
    ]} cellHasFocus={false}>24.7.2026</HarvestOverlapDateCell>);

    expect(screen.getByText('24.7.2026')).toBeInTheDocument();
    expect(screen.queryByTestId('harvest-overlap-date')).not.toBeInTheDocument();
  });
});
