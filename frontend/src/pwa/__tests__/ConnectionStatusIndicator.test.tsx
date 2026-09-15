import { render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import translations from '../../test-utils/translations';
import { ConnectionStatusIndicator } from '../ConnectionStatusIndicator';

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

function renderIndicator(props: { size?: number; hideWhenOnline?: boolean } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ConnectionStatusIndicator size={props.size ?? 36} hideWhenOnline={props.hideWhenOnline} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  setNavigatorOnline(true);
});

describe('ConnectionStatusIndicator', () => {
  it('states the connection explicitly while online', () => {
    setNavigatorOnline(true);
    renderIndicator();

    expect(screen.getByRole('status')).toHaveAccessibleName(translations.navigation.connectionStatus.online);
  });

  it('switches to the offline wording when the connection drops', () => {
    setNavigatorOnline(true);
    renderIndicator();

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('status')).toHaveAccessibleName(translations.navigation.connectionStatus.offline);
  });

  it('keeps the same footprint in both states so the topbar does not reflow', () => {
    setNavigatorOnline(true);
    renderIndicator({ size: 36 });
    const indicator = screen.getByRole('status');

    expect(indicator).toHaveStyle({ width: '36px', height: '36px' });

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('status')).toHaveStyle({ width: '36px', height: '36px' });
  });

  it('renders nothing while online in the compact topbar, which has no room for it', () => {
    setNavigatorOnline(true);
    renderIndicator({ hideWhenOnline: true });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('status')).toHaveAccessibleName(translations.navigation.connectionStatus.offline);
  });
});
