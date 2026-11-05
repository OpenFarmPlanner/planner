import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/authContextShared';
import { createAuthStateMock, createTestUser } from '../test-utils/appHarness';
import { resetTaskDragHintSessionState, useTaskDragHint } from '../components/tasks/useTaskDragHint';

const retire = vi.hoisted(() => vi.fn());
vi.mock('../auth/authApi', () => ({ retireTaskDragHint: retire }));
const auth: AuthContextValue = {
  ...createAuthStateMock(), user: createTestUser(), isAuthUnavailable: false,
  retryAuthCheck: vi.fn(), acceptConsent: vi.fn(), refreshUser: vi.fn(),
};
const wrapper = ({ children }: { children: ReactNode }) => createElement(AuthContext.Provider, { value: auth }, children);

describe('useTaskDragHint', () => {
  beforeEach(() => {
    resetTaskDragHintSessionState();
    auth.user = createTestUser();
    retire.mockReset().mockResolvedValue({ done: true });
  });
  it('persists dismissal and keeps it hidden across mounts', async () => {
    const hook = renderHook(useTaskDragHint, { wrapper });
    expect(hook.result.current.visible).toBe(true);
    await act(() => hook.result.current.retire('dismissed'));
    expect(retire).toHaveBeenCalledWith('dismissed');
    expect(hook.result.current.visible).toBe(false);
    hook.unmount();
    expect(renderHook(useTaskDragHint, { wrapper }).result.current.visible).toBe(false);
  });
  it('honors server state and isolates users', async () => {
    auth.user = createTestUser({ task_drag_hint_done: true });
    const hook = renderHook(useTaskDragHint, { wrapper });
    expect(hook.result.current.visible).toBe(false);
    auth.user = createTestUser({ id: 2, task_drag_hint_done: false });
    hook.rerender();
    expect(hook.result.current.visible).toBe(true);
    await act(() => hook.result.current.retire('moved'));
    expect(hook.result.current.visible).toBe(false);
    auth.user = createTestUser({ id: 3 });
    hook.rerender();
    expect(hook.result.current.visible).toBe(true);
  });
  it('retains the hint and allows retry after a failed persistence request', async () => {
    retire.mockRejectedValueOnce(new Error('offline'));
    const hook = renderHook(useTaskDragHint, { wrapper });
    await act(() => hook.result.current.retire('dismissed'));
    expect(hook.result.current.visible).toBe(true);
    expect(hook.result.current.failed).toBe(true);
    await act(() => hook.result.current.retire('dismissed'));
    expect(hook.result.current.visible).toBe(false);
  });
});
