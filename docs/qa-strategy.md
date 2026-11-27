# QA-Strategie

## Grundprinzip: Change-Based Regression

Nicht bei jedem QA-Lauf alles testen — stattdessen:

1. `git log <letzter-sweep-commit>..HEAD --stat` lesen
2. Nur die **geänderten Bereiche** testen + deren direkte Abhängigkeiten
3. Querschnittskomponenten (Sidebar, TopBar, DataGrid, App.tsx) immer mitprüfen wenn sie sich geändert haben

## Trigger für einen vollen Re-Sweep

- ≥ 20 Commits seit dem letzten vollen Sweep
- Änderungen an Querschnittskomponenten (App.tsx, DataGrid-Wrapper, Sidebar, TopBar)
- Vor einem Release / größerem Feature-Merge
- Nach größeren Dependency-Updates (React, MUI, React Router)

## Ablauf eines QA-Laufs

1. `docs/qa-coverage-*.md` lesen → welche Bereiche wurden zuletzt getestet, bei welchem Commit (nur die aktuellste Datei liegt in `docs/`; ältere Stände in `docs/qa-archive/`)
2. `git log` → was hat sich seitdem geändert
3. `docs/qa-excluded-issues.md` lesen → bekannte Won't-Fix-Items nicht nochmal melden
4. Playwright-Skript schreiben mit E2E-Setup via `/api/__e2e__/invite-flow/` (Action `setup`)
5. Nach dem Lauf: `qa-coverage-*.md` mit aktuellem Datum und Git-Stand aktualisieren

## Was beim nächsten Lauf noch offen ist

- Anbaukalender: Drag & Drop von Planungszeiträumen (schwer in Playwright headless)
- E-Mail-Adresse ändern (Bestätigungslink) und Konto löschen in Kontoeinstellungen
- Weitere offene Bereiche: Abschnitt „Not covered in this sweep“ der aktuellen `qa-coverage-*.md`

## Playwright-Hinweise

- Executablepath: `/usr/bin/google-chrome` mit `args: ['--no-sandbox']`
- E2E-API: `POST /api/__e2e__/invite-flow/` mit Header `X-E2E-Token: openfarmplanner-e2e-token`
  - Response: `{ admin: { email, password }, invitee: { email, password }, inviteUrl, ... }`
- CSS-`hover`-Buttons (Lieferanten, Standorte) per `element.hover()` triggerbar
- Seitenhilfe auf Desktop ist ein `Popover`, kein `Dialog` — `getByRole('dialog')` findet es nicht
- Account-/Projekt-Einstellungen: Felder erscheinen erst nach Klick auf Edit-Button (Collapse-Pattern)
- Headless-only: `useResizeContainer` Warning = kein echter Bug
- Befüllte Projekte: Action `setup_demo` statt `setup` (leeres Projekt mit einem Standort)
- UI-Sprache gehört zum Konto (`UserProjectSettings.ui_language`); `i18nextLng` im Browser reicht für eingeloggte Seiten nicht
- Vor Prüfungen von Backend-Meldungen aus dem Repository-Stamm `cd backend && pdm run compilemessages` ausführen und den Server neu starten. Der Test verwendet dann frisch aus dem Checkout kompilierte Übersetzungskataloge.

## Dokumentation nach einem Lauf

Neue Bugs → in neues `docs/qa-archive/qa-report-YYYY-MM-DD.md` dokumentieren
Won't-Fix-Entscheidungen → in `docs/qa-excluded-issues.md` eintragen
Coverage aktualisieren → `docs/qa-coverage-YYYY-MM-DD.md` (altes umbenennen oder
neues anlegen). In `docs/` bleibt immer nur die aktuellste Coverage-Datei — die
vorherige nach `docs/qa-archive/` verschieben und den Verweis in
`docs/index.md` anpassen.
