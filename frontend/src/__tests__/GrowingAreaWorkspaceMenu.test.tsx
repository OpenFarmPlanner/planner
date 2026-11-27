import { MenuItem } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GrowingAreaWorkspaceMenu } from '../components/hierarchy/GrowingAreaWorkspaceMenu';

it.each(['light', 'dark'] as const)('keeps the workspace action and edit state accessible with the %s palette', async mode => {
  const finishEditing = vi.fn();
  render(<ThemeProvider theme={createTheme({ palette: { mode } })}>
    <GrowingAreaWorkspaceMenu editing description="Bearbeitungsmodus">
      {select => <MenuItem role="menuitemcheckbox" aria-checked="true" onClick={() => select(finishEditing)}>
        Grafikbearbeitung beenden
      </MenuItem>}
    </GrowingAreaWorkspaceMenu>
  </ThemeProvider>);
  const trigger = screen.getByRole('button', { name: 'Arbeitsbereichsmenü', expanded: false });
  expect(trigger).toHaveAccessibleDescription('Bearbeitungsmodus');
  expect(trigger).toHaveClass('MuiButton-contained', 'MuiButton-colorSuccess');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Grafikbearbeitung beenden', checked: true }));
  await waitFor(() => expect(finishEditing).toHaveBeenCalledTimes(1));
  expect(trigger).toHaveFocus();
});
