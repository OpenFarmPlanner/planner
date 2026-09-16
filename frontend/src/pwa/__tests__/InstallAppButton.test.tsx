import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import translations from '../../test-utils/translations';
import { InstallAppButton } from '../InstallAppButton';

function setStandalone(value: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: value,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function setIosUserAgent(isIos: boolean): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: isIos ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' : 'Mozilla/5.0 (Macintosh)',
  });
}

function createBeforeInstallPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

function renderButton() {
  return render(
    <ThemeProvider theme={theme}>
      <InstallAppButton />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  setStandalone(false);
  setIosUserAgent(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InstallAppButton', () => {
  it('renders nothing when neither a native prompt nor iOS install is available', () => {
    renderButton();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders nothing once the app is already installed, even with a captured prompt', () => {
    setStandalone(true);
    renderButton();

    act(() => {
      window.dispatchEvent(createBeforeInstallPromptEvent());
    });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the native prompt when a beforeinstallprompt event was captured', async () => {
    const user = userEvent.setup({ delay: null });
    renderButton();
    const event = createBeforeInstallPromptEvent();

    act(() => {
      window.dispatchEvent(event);
    });

    const button = await screen.findByRole('button', { name: translations.home.landing.actions.installApp });
    await user.click(button);

    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('shows the "Add to Home Screen" instructions on iOS instead of a native prompt', async () => {
    setIosUserAgent(true);
    const user = userEvent.setup({ delay: null });
    renderButton();

    const button = screen.getByRole('button', { name: translations.home.landing.actions.installApp });
    await user.click(button);

    expect(screen.getByRole('dialog')).toHaveTextContent(translations.home.landing.installIos.instructions);
  });

  it('closes the iOS instructions dialog', async () => {
    setIosUserAgent(true);
    const user = userEvent.setup({ delay: null });
    renderButton();

    await user.click(screen.getByRole('button', { name: translations.home.landing.actions.installApp }));
    await user.click(screen.getByRole('button', { name: translations.home.landing.installIos.dismiss }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
