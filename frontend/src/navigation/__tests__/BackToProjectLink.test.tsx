import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/authContextShared';
import { BackToProjectLink } from '../BackToProjectLink';
import {
  LAST_PROJECT_ROUTE_STORAGE_KEY,
  readLastProjectRoute,
  rememberProjectRoute,
} from '../lastProjectRoute';

const renderLink = (activeProjectId: number | null = 3) => {
  const auth = {
    user: { memberships: [{ project_id: 3, project_name: 'Hof Süd', role: 'admin' }] },
    activeProjectId,
  } as unknown as AuthContextValue;
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <BackToProjectLink />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
};

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('lastProjectRoute', () => {
  it('remembers project pages with their query and hash', () => {
    rememberProjectRoute('/app/planting-plans', '?season=2', '#row-4');

    expect(readLastProjectRoute()).toBe('/app/planting-plans?season=2#row-4');
  });

  it.each([
    '/app/account-settings',
    '/app/project-selection',
    '/app/notifications',
    '/login',
  ])('does not count %s as a project page', (pathname) => {
    rememberProjectRoute('/app/crops');
    rememberProjectRoute(pathname);

    // Leaving for account settings must not overwrite where "back" leads.
    expect(readLastProjectRoute()).toBe('/app/crops');
  });

  it('falls back to the project overview when no project page was visited', () => {
    expect(readLastProjectRoute()).toBe('/app/dashboard');
  });

  it('falls back to the overview for a stored value that is not a project page', () => {
    window.sessionStorage.setItem(LAST_PROJECT_ROUTE_STORAGE_KEY, 'https://example.com/app/crops');

    expect(readLastProjectRoute()).toBe('/app/dashboard');
  });
});

describe('BackToProjectLink', () => {
  it('names the active project and leads to the last project page', () => {
    rememberProjectRoute('/app/gantt-chart');
    renderLink();

    expect(screen.getByRole('link', { name: 'Zurück zu Hof Süd' })).toHaveAttribute('href', '/app/gantt-chart');
  });

  it('leads to the project overview when no project page was visited', () => {
    renderLink();

    expect(screen.getByRole('link', { name: 'Zurück zu Hof Süd' })).toHaveAttribute('href', '/app/dashboard');
  });

  it('falls back to a generic label without an active project', () => {
    renderLink(null);

    expect(screen.getByRole('link', { name: 'Zurück zur Übersicht' })).toHaveAttribute('href', '/app/dashboard');
  });
});
