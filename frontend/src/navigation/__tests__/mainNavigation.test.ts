import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { MAIN_NAV_ITEMS, shouldDisableNavItem } from '../mainNavigation';

describe('shouldDisableNavItem', () => {
  it('disables project-dependent items when there is no active project', () => {
    expect(shouldDisableNavItem({ requiresProject: true }, false)).toBe(true);
  });

  it('keeps project-dependent items enabled once a project is active', () => {
    expect(shouldDisableNavItem({ requiresProject: true }, true)).toBe(false);
  });

  it('never disables items that do not require a project', () => {
    expect(shouldDisableNavItem({ requiresProject: false }, false)).toBe(false);
    expect(shouldDisableNavItem({ requiresProject: false }, true)).toBe(false);
  });
});

describe('MAIN_NAV_ITEMS', () => {
  it('marks every current main navigation destination as project-dependent', () => {
    // All of fields-beds/crops/planting-plans/gantt-chart/yield-overview/
    // seed-demand/suppliers only render real content with an active project
    // (each page falls back to ProjectRequiredState otherwise). If a future
    // route works without a project, flip its `requiresProject` explicitly
    // rather than changing this assertion.
    for (const item of MAIN_NAV_ITEMS) {
      expect(item.requiresProject).toBe(true);
    }
  });
});

describe('navigation menu labels', () => {
  const labelKeys = ['dashboard', ...MAIN_NAV_ITEMS.map((item) => item.labelKey)];

  it.each(['de', 'en', 'fr', 'es'])('gives every menu entry its own short label in %s', (language) => {
    const t = i18n.getFixedT(language, 'navigation');
    for (const key of labelKeys) {
      expect(i18n.exists(`navigation:short.${key}`, { lng: language })).toBe(true);
      expect(t(`short.${key}`).length).toBeLessThanOrEqual(t(key).length);
    }
  });

  it('keeps the full term as page title where the menu label is shortened', () => {
    const t = i18n.getFixedT('fr', 'navigation');
    expect(t('short.ganttChart')).toBe('Calendrier');
    expect(t('ganttChart')).toBe('Calendrier de culture');
  });
});
