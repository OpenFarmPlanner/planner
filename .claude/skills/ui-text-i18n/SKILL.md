---
name: ui-text-i18n
description: Add or change user-visible UI text in the frontend in all four languages (de, en, fr, es) with correct plurals, placeholders and glossary terms. Use whenever a component, dialog, snackbar, tooltip, error message or email gets new or changed wording.
---

# UI text in four languages

Rules: `CLAUDE.md` ("Text, Types, and Components"), `docs/i18n.md` section 2
and section 8 (emails), terminology in `docs/i18n-glossary.md`.

## Steps

1. **Find the namespace**: `frontend/src/i18n/locales/<lang>/<namespace>.json`,
   grouped by area (`common`, `crops`, `plantingPlans`, …). Search for an
   existing key with the same meaning before adding one:
   `grep -rn "<German wording>" frontend/src/i18n/locales/de/`.
2. **Name the key** descriptively and hierarchically
   (`crops:form.growthDurationDaysHelp`), never numbered.
3. **Write German first** (the reference bundle), then English, French and
   Spanish. Look up every domain term in the glossary and keep its form of
   address.
4. **Plurals**: use `t('key', { count })`, never `count === 1 ? …`. Add every
   category per language: de/en `_one`, `_other`; fr/es `_one`, `_many`,
   `_other`. French `_one` also covers 0, so interpolate `{{count}}`.
5. **Placeholders**: the same `{{name}}` set in all four languages.
6. **In code**: no hardcoded strings and no `defaultValue` with German text.
   Map enum values, backend field names and API error codes to localized
   labels; never render them raw.
7. **Emails**: change the template under
   `backend/accounts/templates/accounts/emails/<code>/` for every language.

## Verify

```bash
cd frontend
npx vitest run src/__tests__/i18nKeyParity.test.ts src/__tests__/i18nPlurals.test.ts
npm run lint
```

For emails: `cd backend && pdm run test accounts/tests/test_localized_emails.py`.
If the text is visible on a page, check its length in the longest language at
375px with the `visual-review` skill (French and Spanish run longest).
