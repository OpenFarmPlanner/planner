import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../api/types';
import { GraphicalBedLabels } from '../pages/GraphicalBedLabels';
import type { BedCultivationEntry } from '../pages/graphicalCultivation';

vi.mock('react-konva', () => ({
  Circle: () => null,
  Text: ({ text, 'data-testid': testId }: { text: string; 'data-testid': string }) => <span data-testid={testId}>{text}</span>,
}));

const crop: BedCultivationEntry = {
  plan: { id: 5, crop: 6, name: 'Mangold', variety: 'Bright Lights', start: '2026-04-01', end: '2026-06-01',
    planted: null, estimatedHarvest: [], recordedHarvest: [], perennial: false },
  phase: 'growth', recordedHarvest: false,
};
const firstTask: Task = {
  id: 1, project: 2, season: 3, title: 'Kontrollieren', description: '', status: 'pending',
  due_date: '2026-05-15', planting_plan: 5, crop: 6, assigned_to: null, origin: 'manual',
  calculated_due_date: null, due_date_overridden: false, source_key: '', occurrence_index: 0, created_at: '', updated_at: '',
};
const tasks = [firstTask, ...['Mulch nachfüllen', 'Erde lockern', 'Gießkanne holen'].map((title, index) => ({
  ...firstTask, id: index + 2, title, due_date: null,
}))];
const bed = { id: 1, name: 'Nordbeet', x: 0, y: 0, width: 190, height: 115, area: 3 };

describe('graphical bed labels', () => {
  it('fits crops and phase alongside a few task titles, individual dates and an overflow count', () => {
    render(<GraphicalBedLabels bed={bed} scale={1} mode="cropsAndTasks" detailedArea
      crops={[crop]} tasks={tasks} urgency="upcoming" />);
    expect(screen.getByTestId('bed-crop-label-1-0')).toHaveTextContent('Mangold (Bright Lights)');
    expect(screen.getByTestId('bed-phase-label-1-1')).toHaveTextContent('Geplantes Wachstum');
    expect(screen.getByTestId('bed-task-label-1-2')).toHaveTextContent('Kontrollieren');
    expect(screen.getByTestId('bed-task-due-1-2')).toHaveTextContent(/15\.0?5\.2026/);
    expect(screen.getByTestId('bed-task-due-1-3')).toHaveTextContent('Ohne Termin');
    expect(screen.getByTestId('bed-more-tasks-label-1-4')).toHaveTextContent('+2 weitere Aufgaben');
  });

  it('uses the symbol and count on a small bed and omits a shared phase for mixed or whole-season crops', () => {
    const labels = (geometry: typeof bed, crops: BedCultivationEntry[]) => <GraphicalBedLabels bed={geometry} scale={1}
      mode="cropsAndTasks" detailedArea crops={crops} tasks={tasks} urgency="upcoming" />;
    const { rerender } = render(labels({ ...bed, width: 90, height: 24 }, [crop]));
    expect(screen.getByTestId('bed-task-icon-1')).toHaveTextContent('◷ 4');
    expect(screen.queryByText('Kontrollieren')).not.toBeInTheDocument();
    rerender(labels(bed, [crop, { ...crop, plan: { ...crop.plan, id: 7, name: 'Salat' } }]));
    expect(screen.getByTestId('bed-crop-label-1-0')).toHaveTextContent(/Mangold.*Salat/);
    expect(screen.queryByTestId('bed-phase-label-1-1')).not.toBeInTheDocument();
    rerender(labels(bed, [{ ...crop, phase: null }]));
    expect(screen.getByTestId('bed-crop-label-1-0')).toHaveTextContent('Mangold');
    expect(screen.queryByTestId('bed-phase-label-1-1')).not.toBeInTheDocument();
  });
});
