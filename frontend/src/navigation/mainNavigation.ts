export interface MainNavigationItem {
  to: string;
  labelKey: string;
  keywords: string[];
  activeAliases?: string[];
  /**
   * Whether this destination requires an active project to be usable. Drives
   * the sidebar's disabled state during onboarding (no project yet) — see
   * `shouldDisableNavItem`. Kept per-item (rather than assumed globally) so a
   * future route that works without a project can opt out explicitly.
   */
  requiresProject: boolean;
}

export const MAIN_NAV_ITEMS: MainNavigationItem[] = [
  { to: '/app/fields-beds', labelKey: 'fieldsAndBeds', keywords: ['anbauflächen', 'felder', 'beete'], requiresProject: true },
  { to: '/app/crops', labelKey: 'crops', keywords: ['kulturen', 'kultur'], requiresProject: true },
  { to: '/app/crop-library', labelKey: 'cropLibrary', keywords: ['kulturbibliothek', 'öffentliche kulturen', 'crop library'], requiresProject: true },
  { to: '/app/planting-plans', labelKey: 'plantingPlans', activeAliases: ['/app/anbauplaene'], keywords: ['anbaupläne', 'pläne', 'planung'], requiresProject: true },
  { to: '/app/gantt-chart', labelKey: 'ganttChart', keywords: ['anbaukalender', 'kalender', 'gantt'], requiresProject: true },
  { to: '/app/yield-overview', labelKey: 'yieldOverview', keywords: ['ertragsübersicht', 'ertrag', 'ernte'], requiresProject: true },
  { to: '/app/seed-demand', labelKey: 'seedDemand', keywords: ['saatgutbedarf', 'saatgut'], requiresProject: true },
  { to: '/app/young-plant-demand', labelKey: 'youngPlantDemand', keywords: ['jungpflanzenbedarf', 'jungpflanzen', 'zukauf'], requiresProject: true },
  { to: '/app/suppliers', labelKey: 'suppliers', keywords: ['lieferanten', 'einkauf'], requiresProject: true },
];

/** Whether a nav item should render disabled given the current project state. */
export const shouldDisableNavItem = (
  item: Pick<MainNavigationItem, 'requiresProject'>,
  hasActiveProject: boolean,
): boolean => item.requiresProject && !hasActiveProject;

/**
 * Routes under `/app` that work correctly for a user with zero projects —
 * account-scoped or project-management pages, not project-scoped content.
 *
 * This is the single source of truth for the "force users with no project to
 * project-selection" guard in RootLayout: any route NOT listed here is
 * treated as project-scoped and will redirect a projectless user to
 * `/app/project-selection` instead of rendering. Add a route here when it is
 * genuinely usable without any project, rather than special-casing it in the
 * redirect logic itself.
 */
export const PROJECT_INDEPENDENT_APP_ROUTES: readonly string[] = [
  '/app/project-selection',
  '/app/account-settings',
  '/app/public-library-moderation',
  '/app/notifications',
];

/** Whether `pathname` is exempt from the "no project yet" redirect guard. */
export const isProjectIndependentRoute = (pathname: string): boolean => {
  const normalizedPath = pathname.replace(/\/$/, '') || '/';
  return PROJECT_INDEPENDENT_APP_ROUTES.some(
    (route) => normalizedPath === route || normalizedPath.startsWith(`${route}/`),
  );
};

export const MAIN_NAV_ROUTES = MAIN_NAV_ITEMS.map((item) => item.to);
export const KEYBOARD_NAV_ROUTES = ['/app/dashboard', ...MAIN_NAV_ROUTES];
export const ORDERED_APP_ROUTES = KEYBOARD_NAV_ROUTES;

export const normalizeMainRoutePath = (pathname: string): string => {
  const normalizedPath = pathname.replace(/\/$/, '') || '/';
  if (normalizedPath === '/anbauplaene') {
    return '/app/planting-plans';
  }
  if (normalizedPath.startsWith('/app/')) {
    return normalizedPath;
  }
  return normalizedPath === '/' ? '/app/dashboard' : `/app${normalizedPath}`;
};

export const getActiveMainRouteFromPathname = (pathname: string): string | null => {
  const normalizedPath = normalizeMainRoutePath(pathname);
  const aliasedPath = normalizedPath === '/app/anbauplaene'
    ? '/app/planting-plans'
    : normalizedPath;

  const matchingRoute = KEYBOARD_NAV_ROUTES
    .filter((route) => aliasedPath === route || aliasedPath.startsWith(`${route}/`))
    .sort((first, second) => second.length - first.length)[0];

  return matchingRoute ?? null;
};

export const getKeyboardNavigationRouteFromPathname = (pathname: string): string | null => {
  const activeRoute = getActiveMainRouteFromPathname(pathname);
  if (activeRoute) {
    return activeRoute;
  }

  const normalizedPath = normalizeMainRoutePath(pathname);
  if (normalizedPath === '/app/locations' || normalizedPath.startsWith('/app/locations/')) {
    return '/app/dashboard';
  }

  return null;
};
