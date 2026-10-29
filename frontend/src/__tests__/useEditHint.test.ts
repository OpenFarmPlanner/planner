import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/authContextShared';
import type { TableEditHintState } from '../auth/types';
import {
  resetTableEditHintSessionState,
  TABLE_EDIT_HINT_MAX_SHOWN,
  useEditHint,
} from '../components/data-grid/useEditHint';

const mockRecordTableEditHintEvent = vi.hoisted(() => vi.fn());

vi.mock('../auth/authApi', () => ({
  recordTableEditHintEvent: (...args: unknown[]) => mockRecordTableEditHintEvent(...args),
}));

const createAuthValue = (hint?: TableEditHintState): AuthContextValue => ({
  user: {
    id: 7,
    email: 'user-7@example.test',
    display_name: 'User 7',
    display_label: 'User 7',
    public_display_name: '',
    is_active: true,
    default_project_id: null,
    last_project_id: null,
    resolved_project_id: null,
    needs_project_selection: false,
    memberships: [],
    account_pending_deletion: false,
    scheduled_deletion_at: null,
    pending_consents: [],
    public_library_terms_accepted: false,
    is_guest_demo: false,
    guest_demo_session_id: null,
    has_password: true,
    table_edit_hint: hint,
  },
  isLoading: false,
  activeProjectId: null,
  login: vi.fn(),
  startGuestDemo: vi.fn(),
  endGuestDemo: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  acceptConsent: vi.fn(),
  activate: vi.fn(),
  resendActivation: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  requestAccountDeletion: vi.fn(),
  restoreAccount: vi.fn(),
  switchActiveProject: vi.fn(),
  refreshUser: vi.fn(),
});

const cellElement = (): HTMLElement => document.createElement('div');

const renderEditHint = (hint?: TableEditHintState) => {
  const authValue = createAuthValue(hint);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(AuthContext.Provider, { value: authValue }, children);
  return renderHook(() => useEditHint(), { wrapper });
};

describe('useEditHint', () => {
  beforeEach(() => {
    resetTableEditHintSessionState();
    mockRecordTableEditHintEvent.mockReset();
    mockRecordTableEditHintEvent.mockImplementation(() => new Promise(() => {}));
  });

  it('shows the hint at the given cell and reports the display', () => {
    const { result } = renderEditHint();
    const cell = document.createElement('div');

    act(() => result.current.requestHint(cell));

    expect(result.current.open).toBe(true);
    expect(result.current.anchorEl).toBe(cell);
    expect(mockRecordTableEditHintEvent).toHaveBeenCalledWith('shown');
  });

  it('shows the hint only once per page visit, even on other cells', () => {
    const { result } = renderEditHint();

    act(() => result.current.requestHint(cellElement()));
    act(() => result.current.close());
    act(() => result.current.requestHint(cellElement()));

    expect(result.current.open).toBe(false);
    expect(mockRecordTableEditHintEvent).toHaveBeenCalledTimes(1);
  });

  it(`stops after ${TABLE_EDIT_HINT_MAX_SHOWN} page visits with the hint`, () => {
    for (let visit = 0; visit < TABLE_EDIT_HINT_MAX_SHOWN; visit += 1) {
      const { result, unmount } = renderEditHint();
      act(() => result.current.requestHint(cellElement()));
      expect(result.current.open).toBe(true);
      unmount();
    }
    const { result } = renderEditHint();
    act(() => result.current.requestHint(cellElement()));

    expect(result.current.open).toBe(false);
    expect(mockRecordTableEditHintEvent).toHaveBeenCalledTimes(TABLE_EDIT_HINT_MAX_SHOWN);
  });

  it('starts from the count stored on the server', () => {
    const firstVisit = renderEditHint({ done: false, shown_count: TABLE_EDIT_HINT_MAX_SHOWN - 1 });
    act(() => firstVisit.result.current.requestHint(cellElement()));
    expect(firstVisit.result.current.open).toBe(true);
    firstVisit.unmount();

    const nextVisit = renderEditHint({ done: false, shown_count: TABLE_EDIT_HINT_MAX_SHOWN - 1 });
    act(() => nextVisit.result.current.requestHint(cellElement()));

    expect(nextVisit.result.current.open).toBe(false);
  });

  it('never shows for a user who already retired it on another device', () => {
    const { result } = renderEditHint({ done: true, shown_count: 1 });

    act(() => result.current.requestHint(cellElement()));

    expect(result.current.open).toBe(false);
    expect(mockRecordTableEditHintEvent).not.toHaveBeenCalled();
  });

  it('retires the hint for good when the close button dismisses it', () => {
    const firstVisit = renderEditHint();
    act(() => firstVisit.result.current.requestHint(cellElement()));
    act(() => firstVisit.result.current.dismiss());
    firstVisit.unmount();

    const nextVisit = renderEditHint();
    act(() => nextVisit.result.current.requestHint(cellElement()));

    expect(nextVisit.result.current.open).toBe(false);
    expect(mockRecordTableEditHintEvent).toHaveBeenLastCalledWith('dismissed');
  });

  it('comes back on the next page visit after it only timed out', () => {
    const firstVisit = renderEditHint();
    act(() => firstVisit.result.current.requestHint(cellElement()));
    act(() => firstVisit.result.current.close());
    firstVisit.unmount();

    const nextVisit = renderEditHint();
    act(() => nextVisit.result.current.requestHint(cellElement()));

    expect(nextVisit.result.current.open).toBe(true);
  });

  it('retires the hint in every table once the user edited a cell in one of them', () => {
    const plantingPlansTable = renderEditHint();
    const growingAreasTable = renderEditHint();

    act(() => plantingPlansTable.result.current.markEdited());
    act(() => growingAreasTable.result.current.requestHint(cellElement()));

    expect(growingAreasTable.result.current.open).toBe(false);
    expect(mockRecordTableEditHintEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordTableEditHintEvent).toHaveBeenCalledWith('edited');
  });

  it('reports an edit only once per session', () => {
    const { result } = renderEditHint();

    act(() => result.current.markEdited());
    act(() => result.current.markEdited());

    expect(mockRecordTableEditHintEvent).toHaveBeenCalledTimes(1);
  });

  it('works without a signed-in user, without reaching the server', () => {
    const { result } = renderHook(() => useEditHint());

    act(() => result.current.requestHint(cellElement()));

    expect(result.current.open).toBe(true);
    expect(mockRecordTableEditHintEvent).not.toHaveBeenCalled();
  });
});
