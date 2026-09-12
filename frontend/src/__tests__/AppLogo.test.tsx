import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import AppLogo from '../components/layout/AppLogo';

describe('AppLogo', () => {
  it('renders with a standard MUI theme', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter initialEntries={['/app/dashboard']}>
          <AppLogo />
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(screen.getByRole('link')).toBeInTheDocument();
  });
});
