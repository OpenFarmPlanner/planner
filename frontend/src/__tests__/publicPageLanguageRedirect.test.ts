import { afterEach, describe, expect, it, vi } from 'vitest';

import { LANGUAGE_STORAGE_KEY } from '../i18n/languages';
import {
  isCrawlerUserAgent,
  preferredPublicPagePath,
  redirectToPreferredLanguageVersion,
} from '../i18n/publicPageLanguageRedirect';

const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const GOOGLEBOT_UA =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/141.0 Safari/537.36';

function stubBrowser(pathname: string, languages: string[], userAgent = CHROME_UA) {
  const replace = vi.fn();
  vi.stubGlobal('location', { pathname, search: '?ref=x', hash: '#top', replace });
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(languages[0] ?? '');
  return replace;
}

afterEach(() => {
  window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
});

describe('preferredPublicPagePath', () => {
  it('returns the counterpart of a public page in the other language', () => {
    expect(preferredPublicPagePath('/ueber', 'en')).toBe('/en/about');
    expect(preferredPublicPagePath('/en/legal-notice', 'de')).toBe('/impressum');
    expect(preferredPublicPagePath('/', 'en')).toBe('/en');
  });

  it('stays put on a page already in that language or off public pages', () => {
    expect(preferredPublicPagePath('/ueber', 'de')).toBeNull();
    expect(preferredPublicPagePath('/login', 'en')).toBeNull();
  });
});

describe('isCrawlerUserAgent', () => {
  it('recognises search engine crawlers but not browsers', () => {
    expect(isCrawlerUserAgent(GOOGLEBOT_UA)).toBe(true);
    expect(isCrawlerUserAgent('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true);
    expect(isCrawlerUserAgent(CHROME_UA)).toBe(false);
  });
});

describe('redirectToPreferredLanguageVersion', () => {
  it('sends a non-German browser from a German page to the English version', () => {
    const replace = stubBrowser('/ueber', ['fr-FR', 'en-US']);
    expect(redirectToPreferredLanguageVersion()).toBe(true);
    expect(replace).toHaveBeenCalledWith('/en/about?ref=x#top');
  });

  it('sends a German browser from an English page to the German version', () => {
    const replace = stubBrowser('/en/about', ['de-AT']);
    expect(redirectToPreferredLanguageVersion()).toBe(true);
    expect(replace).toHaveBeenCalledWith('/ueber?ref=x#top');
  });

  it('lets an explicit language choice win over the browser language', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const replace = stubBrowser('/ueber', ['en-US']);
    expect(redirectToPreferredLanguageVersion()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('never redirects crawlers', () => {
    const replace = stubBrowser('/ueber', ['en-US'], GOOGLEBOT_UA);
    expect(redirectToPreferredLanguageVersion()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves non-public routes alone', () => {
    const replace = stubBrowser('/login', ['en-US']);
    expect(redirectToPreferredLanguageVersion()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
