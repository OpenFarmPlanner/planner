import { isProjectIndependentRoute } from './mainNavigation';

/** Session storage key for the last visited project-scoped route (per tab). */
export const LAST_PROJECT_ROUTE_STORAGE_KEY = 'ofp.lastProjectRoute';

/** Where "back to project" leads when no project page was visited in this tab. */
export const PROJECT_OVERVIEW_ROUTE = '/app/dashboard';

const isProjectRoute = (pathname: string): boolean =>
  pathname.startsWith('/app/') && !isProjectIndependentRoute(pathname);

/** Remembers `pathname` (with search and hash) if it is a project-scoped app route. */
export function rememberProjectRoute(pathname: string, search = '', hash = ''): void {
  if (!isProjectRoute(pathname)) {
    return;
  }
  try {
    window.sessionStorage.setItem(LAST_PROJECT_ROUTE_STORAGE_KEY, `${pathname}${search}${hash}`);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the
    // back link then falls back to the project overview.
  }
}

/** The last visited project route of this tab, or the project overview. */
export function readLastProjectRoute(): string {
  try {
    const stored = window.sessionStorage.getItem(LAST_PROJECT_ROUTE_STORAGE_KEY);
    if (stored && isProjectRoute(stored.split(/[?#]/)[0])) {
      return stored;
    }
  } catch {
    // Fall through to the overview.
  }
  return PROJECT_OVERVIEW_ROUTE;
}
