import { render, screen } from '@testing-library/react';
import { Paper, ThemeProvider, createTheme } from '@mui/material';
import { describe, expect, it } from 'vitest';
import { bedTaskDateBounds } from '../components/tasks/bedTaskUrgency';
import { GraphicalBedHoverDetails } from '../pages/GraphicalBedHoverDetails';
import { bedTaskColors } from '../pages/graphicalBedTaskStyle';

const defaultProps = {
  tasks: [], taskLoading: false, taskFailed: false, cropLoading: false, cropFailed: false,
  taskBounds: bedTaskDateBounds(new Date(2026, 4, 15)),
};
const noTasks = 'Keine offenen Aufgaben für dieses Beet.';

describe('graphical bed tooltip', () => {
  it.each(['light', 'dark'] as const)('distinguishes empty, pending and unavailable task data in the %s theme', mode => {
    const theme = createTheme({ palette: { mode } });
    const tooltip = (props: Partial<typeof defaultProps> = {}) => (
      <ThemeProvider theme={theme}>
        <Paper role="tooltip"><GraphicalBedHoverDetails {...defaultProps} {...props} /></Paper>
      </ThemeProvider>
    );
    const { rerender } = render(tooltip());
    expect(screen.getByRole('tooltip')).toHaveTextContent(noTasks);
    rerender(tooltip({ taskLoading: true }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Lädt...');
    expect(screen.queryByText(noTasks)).not.toBeInTheDocument();
    rerender(tooltip({ taskFailed: true }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Die Beetaufgaben konnten nicht geladen werden.');
    expect(screen.queryByText(noTasks)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    const fills = (['overdue', 'upcoming', 'later', 'undated'] as const).map(urgency => bedTaskColors(theme, urgency).fill);
    expect(new Set(fills).size).toBe(4);
  });
});
