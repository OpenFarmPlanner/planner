---
name: public-page
description: Add or change a public, indexable marketing page (landing, about, legal) in all four languages with correct routing, prerendering, sitemap, canonical and hreflang. Use for any change to a page listed in PUBLIC_PAGES or a new public page.
---

# Public page (SEO)

The checklist and its rationale live in `CLAUDE.md` ("Public pages and SEO")
and `docs/seo-and-indexing.md`. Read both first; this skill is the order of
work, not a second copy of the rules.

## Steps

1. **Register** the page in `PUBLIC_PAGES` (`frontend/src/seo/seoConfig.ts`):
   German path at the root, `/en`, `/fr`, `/es` paths with slugs in that
   language, sitemap `changefreq`/`priority`, `titleKey`/`descriptionKey`.
   Map its id in `PUBLIC_PAGE_ELEMENTS` (`frontend/src/App.tsx`).
2. **Translate**: `seo.titles.*`, `seo.descriptions.*` and the page content
   in de, en, fr, es; follow the `ui-text-i18n` skill. Legal pages: the
   prevailing-language clause lives in the terms text only.
3. **Link** only through `usePublicPagePath(id)`; never hardcode a public
   path, canonical, hreflang or sitemap entry.
4. **App-only routes** never become public pages: add their prefixes (and the
   `/en`, `/fr`, `/es` twins) to `NON_INDEXABLE_PATH_PREFIXES`.
5. **Legal texts**: decide whether the change needs renewed user consent; if
   so, implement the consent/version bump in the same change, otherwise say
   so in the summary (`CLAUDE.md`, "Agent Collaboration Preferences").
6. **Verify**:
   ```bash
   cd frontend
   npx vitest run src/seo build
   npm run build                     # fails on SEO guard errors
   npx playwright test e2e/public-page-prerendering.spec.ts
   ```
   Then run the `visual-review` skill for the page at 375px and desktop.

Check the result for slashless URLs on the apex host, and that each language
URL renders its own language.
