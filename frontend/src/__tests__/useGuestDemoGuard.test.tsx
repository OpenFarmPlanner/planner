import { describe, expect, it, onTestFinished } from 'vitest';
import type { ReactNode } from 'react';
import { render, renderHook, screen } from '@testing-library/react';
import { AuthContext, type AuthContextValue } from '../auth/authContextShared';
import { useGuestDemoGuard } from '../auth/useGuestDemoGuard';
import { GuestDemoNotice } from '../components/GuestDemoNotice';
import { GLOBAL_SNACKBAR_EVENT, type GlobalSnackbarDetail } from '../utils/globalSnackbar';

function authWrapper(isGuestDemo: boolean) {
  const value = { user: { is_guest_demo: isGuestDemo } } as unknown as AuthContextValue;
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  };
}

function listenForSnackbars(): GlobalSnackbarDetail[] {
  const received: GlobalSnackbarDetail[] = [];
  const listener = (event: Event) => {
    received.push((event as CustomEvent<GlobalSnackbarDetail>).detail);
  };
  window.addEventListener(GLOBAL_SNACKBAR_EVENT, listener);
  onTestFinished(() => window.removeEventListener(GLOBAL_SNACKBAR_EVENT, listener));
  return received;
}

describe('useGuestDemoGuard', () => {
  it('blocks the action in the guest demo and explains why', () => {
    const received = listenForSnackbars();
    const { result } = renderHook(() => useGuestDemoGuard(), { wrapper: authWrapper(true) });

    expect(result.current.isGuestDemo).toBe(true);
    expect(result.current.blockInGuestDemo('publishCrop')).toBe(true);
    expect(received).toEqual([{
      message: expect.stringContaining('In der Demo kannst du keine Kulturen in der öffentlichen Kulturbibliothek veröffentlichen'),
      severity: 'info',
    }]);
  });

  it('lets every other account through without a message', () => {
    const received = listenForSnackbars();
    const { result } = renderHook(() => useGuestDemoGuard(), { wrapper: authWrapper(false) });

    expect(result.current.isGuestDemo).toBe(false);
    expect(result.current.blockInGuestDemo('publishCrop')).toBe(false);
    expect(received).toEqual([]);
  });

  it('treats a component outside the auth provider as a regular account', () => {
    const { result } = renderHook(() => useGuestDemoGuard());

    expect(result.current.isGuestDemo).toBe(false);
  });
});

describe('GuestDemoNotice', () => {
  it('shows the explanation only in the guest demo', () => {
    const { unmount } = render(<GuestDemoNotice messageKey="createProject" />, { wrapper: authWrapper(true) });
    expect(screen.getByTestId('guest-demo-notice')).toHaveTextContent('In der Demo kannst du keine weiteren Projekte anlegen.');
    unmount();

    render(<GuestDemoNotice messageKey="createProject" />, { wrapper: authWrapper(false) });
    expect(screen.queryByTestId('guest-demo-notice')).not.toBeInTheDocument();
  });
});
