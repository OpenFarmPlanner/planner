/**
 * Tests for i18n configuration and functionality.
 *
 * These deliberately avoid asserting exact translated wording (that's covered,
 * where it matters, by i18nKeyParity.test.ts and dedicated feature tests).
 * Instead they check the properties that actually indicate i18n is wired up
 * correctly: keys resolve to real content, interpolation works, namespaces
 * are all registered, and distinct concepts don't collapse onto one string.
 */

import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import helpDE from '../i18n/locales/de/help.json';
import helpEN from '../i18n/locales/en/help.json';

describe('i18n Configuration', () => {
  it('should be configured with German as default language', () => {
    expect(i18n.language).toBe('de');
  });

  it('resolves known keys to real content instead of echoing the key back', () => {
    const keys = [
      'common:appName',
      'navigation:plantingPlans',
      'navigation:locations',
      'navigation:crops',
      'navigation:cropLibrary',
      'navigation:cropActions.library',
      'crops:title',
      'crops:library.dialogTitle',
      'crops:library.page.title',
    ];

    for (const key of keys) {
      const value = i18n.t(key);
      expect(value, `${key} should resolve`).not.toBe(key);
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps the crop-library navigation entry and the public library entry distinct', () => {
    for (const language of ['de', 'en']) {
      const t = i18n.getFixedT(language);
      expect(t('navigation:crops')).not.toBe(t('navigation:cropLibrary'));
      expect(t('crops:library.dialogTitle')).not.toBe(t('crops:library.page.title'));
    }
  });

  it('should support interpolation', () => {
    const harvestWindow = i18n.t('crops:fields.harvestWindowValue', { first: 60, last: 90 });
    expect(harvestWindow).toContain('60');
    expect(harvestWindow).toContain('90');
  });

  it('interpolates the share action into the import dialog sharing hint', () => {
    const hint = i18n.t('crops:library.importDialog.shareHint', { shareAction: 'In Bibliothek teilen' });
    expect(hint).toContain('„In Bibliothek teilen“');
  });

  it('should have all required namespaces', () => {
    const namespaces = ['common', 'navigation', 'home', 'locations', 'crops', 'plantingPlans', 'fields', 'beds', 'hierarchy'];

    namespaces.forEach(ns => {
      expect(i18n.hasResourceBundle('de', ns)).toBe(true);
    });
  });

  it('uses compact page help introductions instead of "what do I see here" sections', () => {
    const helpResources = [helpDE, helpEN];
    const deprecatedTitles = new Set(['Was sehe ich hier?', 'What do I see here?']);

    helpResources.forEach((helpResource) => {
      Object.values(helpResource.pages).forEach((page) => {
        expect(page.intro).toEqual(expect.any(String));
        expect(page.intro.trim().length).toBeGreaterThan(0);
        expect(page.intro).not.toContain('•');

        page.sections?.forEach((section) => {
          expect(deprecatedTitles.has(section.title)).toBe(false);
          expect(section.points.length).toBeGreaterThan(0);
        });
      });
    });
  });
});
