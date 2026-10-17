import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import translations from '../../test-utils/translations';
import { InstallAppButton } from '../InstallAppButton';

function setMatchMedia({ standalone, mobile }: { standalone: boolean; mobile: boolean }): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('display-mode: standalone') ? standalone : mobile,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function setStandalone(value: boolean): void {
  setMatchMedia({ standalone: value, mobile: true });
}

function setUserAgent(value: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value });
}

function setIosUserAgent(isIos: boolean): void {
  setUserAgent(isIos ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' : 'Mozilla/5.0 (Macintosh)');
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
  it('renders nothing when neither a native prompt nor a manual install is available', () => {
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

  it('renders nothing on desktop, even with a captured prompt', () => {
    setMatchMedia({ standalone: false, mobile: false });
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

    expect(screen.getByRole('dialog')).toHaveTextContent(translations.home.landing.installManual.ios);
  });

  it('closes the iOS instructions dialog', async () => {
    setIosUserAgent(true);
    const user = userEvent.setup({ delay: null });
    renderButton();

    await user.click(screen.getByRole('button', { name: translations.home.landing.actions.installApp }));
    await user.click(screen.getByRole('button', { name: translations.home.landing.installManual.dismiss }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the Firefox menu instructions on Firefox for Android', async () => {
    setUserAgent('Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0');
    const user = userEvent.setup({ delay: null });
    renderButton();

    await user.click(screen.getByRole('button', { name: translations.home.landing.actions.installApp }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(translations.home.landing.installManual.title);
    expect(dialog).toHaveTextContent(translations.home.landing.installManual.firefoxAndroid);
  });

  it('shows the iOS instructions on an iPad wider than the mobile breakpoint', () => {
    setMatchMedia({ standalone: false, mobile: false });
    setIosUserAgent(true);
    renderButton();

    expect(screen.getByRole('button', { name: translations.home.landing.actions.installApp })).toBeInTheDocument();
  });

  it('renders nothing for desktop Firefox, which offers no install', () => {
    setMatchMedia({ standalone: false, mobile: false });
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0');
    renderButton();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
