import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Must default to the same BACKEND_PORT used to configure the backend webServer in
// playwright.config.ts, or fixture setup silently hits whatever else happens to be
// running on port 8000 (e.g. a developer's own long-running dev backend) instead of
// the backend actually under test.
const defaultBackendPort = process.env.BACKEND_PORT ?? '8000';
const e2eApiBase = process.env.PLAYWRIGHT_E2E_API_BASE ?? `http://127.0.0.1:${defaultBackendPort}/api/__e2e__/invite-flow/`;
const e2eToken = process.env.E2E_TEST_TOKEN || 'openfarmplanner-e2e-token';

export const VIEWPORTS = [
  { key: 'mobile', width: 375, height: 800 },
  { key: 'tablet', width: 768, height: 900 },
  { key: 'small-desktop', width: 1024, height: 900 },
  { key: 'desktop', width: 1440, height: 900 },
] as const;

export const MAIN_ROUTES = [
  { key: 'dashboard', path: '/app/dashboard', ready: /Übersicht|Dashboard/i },
  { key: 'anbauflaechen', path: '/app/fields-beds', ready: /Anbauflächen|Parzellen|Beete/i },
  { key: 'kulturen', path: '/app/crops', ready: /Kulturbibliothek/i },
  { key: 'anbauplaene', path: '/app/anbauplaene', ready: /Anbaupläne|Anbauplan/i },
  { key: 'anbaukalender', path: '/app/gantt-chart', ready: /Anbaukalender|Kalender/i },
  { key: 'ertragsuebersicht', path: '/app/yield-overview', ready: /Ertragsübersicht|Ertragsverteilung|Ertragsprognose/i },
  { key: 'saatgutbedarf', path: '/app/seed-demand', ready: /Saatgutbedarf/i },
  { key: 'lieferanten', path: '/app/suppliers', ready: /Lieferanten/i },
] as const;

async function invokeE2EAction(request: APIRequestContext, action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await request.post(e2eApiBase, {
    headers: { 'X-E2E-Token': e2eToken },
    data: { action, ...payload },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Record<string, unknown>;
}

export async function setupUserWithoutProjects(
  request: APIRequestContext,
  scenarioId: string,
): Promise<{ email: string; password: string }> {
  await invokeE2EAction(request, 'reset', { scenario_id: scenarioId });
  const fixture = await invokeE2EAction(request, 'setup_empty_user', { scenario_id: scenarioId }) as {
    user: { email: string; password: string };
  };
  return fixture.user;
}

export async function resetE2EScenario(
  request: APIRequestContext,
  scenarioId: string,
): Promise<void> {
  await invokeE2EAction(request, 'reset', { scenario_id: scenarioId });
}

export interface LoginCredentials {
  email: string;
  password: string;
}

const LOGIN_SUBMIT_ATTEMPTS = 3;
const LOGIN_RETRY_BACKOFF_MS = 1_000;

export async function fillLoginForm(page: Page, credentials: LoginCredentials): Promise<void> {
  await page.getByLabel('E-Mail').fill(credentials.email);
  await page.locator('input[type="password"]').fill(credentials.password);
}

// Submits the already-filled login form and waits for the app shell. Every
// spec starts here, so one transient failure costs a whole test — and two
// different causes produce the identical symptom (form still on screen, URL
// still /login), which is why they are retried the same way:
//
//  - The invite flow reaches /login through InvitationAcceptPage's
//    client-side `navigate()`, fired from an effect that can run again and
//    re-render the form after the fields were filled. The typed values are
//    then gone and the submit posts empty credentials, which only produces an
//    error alert. Passing `credentials` lets each attempt re-assert the
//    fields, which is the only way to recover from that one.
//  - A login POST can fail transiently under CI load (a throttled burst, a
//    backend hiccup), leaving the same error alert.
//
// A form that has already disappeared means a navigation is under way and
// just slower than the wait, so that case rethrows rather than resubmitting.
// A failure that survives every attempt reports the form's own alert text, so
// the next CI failure says why instead of only "still on /login".
export async function submitLoginFormAndAwaitApp(
  page: Page,
  credentials?: LoginCredentials,
): Promise<void> {
  const submit = page.getByRole('button', { name: 'Anmelden', exact: true });
  const emailField = page.getByLabel('E-Mail');

  for (let attempt = 1; attempt <= LOGIN_SUBMIT_ATTEMPTS; attempt += 1) {
    if (credentials && (await emailField.inputValue().catch(() => '')) !== credentials.email) {
      await fillLoginForm(page, credentials);
    }

    // The button is disabled while a submit is in flight, so this also keeps a
    // retry from clicking into the previous attempt.
    await expect(submit).toBeEnabled();
    await submit.click();

    try {
      await expect(page).toHaveURL(/\/app\//, { timeout: 10_000 });
      return;
    } catch (error) {
      if (!(await submit.isVisible().catch(() => false))) {
        throw error;
      }
      if (attempt === LOGIN_SUBMIT_ATTEMPTS) {
        const alerts = await page.getByRole('alert').allTextContents().catch(() => []);
        const reported = alerts.map((text) => text.trim()).filter(Boolean).join(' | ');
        throw new Error(
          `Login did not reach the app shell after ${LOGIN_SUBMIT_ATTEMPTS} attempts. `
          + `URL: ${page.url()}. Form alerts: ${reported || 'none'}.`,
          { cause: error },
        );
      }
      await page.waitForTimeout(LOGIN_RETRY_BACKOFF_MS);
    }
  }
}

export async function loginWithDeterministicProject(
  page: Page,
  request: APIRequestContext,
  scenarioId: string,
  options: {
    demoProject?: boolean;
    loginAsAdmin?: boolean;
    languageCode?: 'de' | 'en';
    /** Grants the admin fixture user crop-library moderator rights. */
    libraryModerator?: boolean;
  } = {},
): Promise<void> {
  await invokeE2EAction(request, 'reset', { scenario_id: scenarioId });
  const fixture = await invokeE2EAction(request, options.demoProject ? 'setup_demo' : 'setup', {
    scenario_id: scenarioId,
    invitation_state: 'pending',
    ...(options.languageCode ? { language_code: options.languageCode } : {}),
    ...(options.libraryModerator ? { library_moderator: true } : {}),
  }) as {
    inviteUrl: string;
    admin: { email: string; password: string };
    invitee: { email: string; password: string };
  };

  const loginUser = options.loginAsAdmin ? fixture.admin : fixture.invitee;
  await page.goto(options.loginAsAdmin ? '/login' : fixture.inviteUrl);
  await fillLoginForm(page, loginUser);
  await submitLoginFormAndAwaitApp(page, loginUser);
}

// Saves a fields-beds hierarchy row by tabbing through the editable cells, then
// forcing a blur. The row has a non-editable "notes" cell after width_m;
// tabbing past it moves focus outside the grid entirely without MUI ever
// firing rowEditStop, so the row stays visually in edit mode until something
// else blurs it explicitly.
export async function tabSaveHierarchyRow(page: Page): Promise<void> {
  // Lets MUI's internal (debounced) cell-edit commit for the name field flush
  // before tabbing away, since tabbing away immediately can lose that edit and
  // cause the row to be wrongly treated as empty on blur.
  await page.waitForTimeout(100);
  await page.keyboard.press('Tab'); // name → length_m
  await page.keyboard.press('Tab'); // length_m → width_m
  await page.keyboard.press('Tab'); // width_m → notes (focusable but not editable)
  // Let MUI finish processing the last Tab (committing the row's tracked edit
  // state) before the click-away triggers the save; clicking immediately can
  // read an incomplete edit state and wrongly treat the row as empty.
  await page.waitForTimeout(200);
  await page.locator('h1', { hasText: 'Anbauflächen' }).click();
}

/**
 * Calls the project API from inside the page, reusing the logged-in session,
 * its CSRF cookie and the active project - the shortest way for a spec to set
 * up domain data that has no dedicated E2E fixture action.
 */
export async function apiRequest<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const activeProjectId = await page.evaluate(() => window.localStorage.getItem('activeProjectId'));
  const csrfToken = await page.evaluate(() =>
    document.cookie.split('; ').find((row) => row.startsWith('csrftoken='))?.split('=')[1] ?? '');

  const result = await page.evaluate(async ({ requestMethod, requestPath, requestData, requestProjectId, requestCsrfToken }) => {
    const response = await fetch(`/api${requestPath}`, {
      method: requestMethod,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': requestCsrfToken,
        'X-Project-Id': String(requestProjectId),
      },
      body: requestMethod === 'GET' ? undefined : JSON.stringify(requestData ?? {}),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
    };
  }, {
    requestMethod: method,
    requestPath: path,
    requestData: data,
    requestProjectId: activeProjectId,
    requestCsrfToken: csrfToken,
  });

  expect(result.ok, `${method} ${path} -> ${result.status}: ${result.text}`).toBeTruthy();
  return JSON.parse(result.text) as T;
}

export async function setViewportPreset(page: Page, preset: (typeof VIEWPORTS)[number]): Promise<void> {
  await page.setViewportSize({ width: preset.width, height: preset.height });
}

export async function waitForPageStable(page: Page, readyPattern?: RegExp): Promise<void> {
  await page.waitForLoadState('networkidle');
  if (readyPattern) {
    await expect(page.getByText(readyPattern).first()).toBeVisible();
  }
  await expect(page.locator('main, [role="main"]').first()).toBeVisible();
}

// The data grids render their rows continuously (EditableDataGrid's
// `scrollMode="continuous"`), so the number of rendered `[role="row"]` elements
// keeps growing for a moment after the grid's first paint. Tests that snapshot a
// "row count before" and assert the same count afterwards have to wait for that
// growth to finish first, or they compare a partially rendered grid against a
// fully rendered one and fail with a larger count than they captured.
export async function waitForStableRowCount(page: Page): Promise<number> {
  const rows = page.locator('[role="row"][data-id]');
  await expect(rows.first()).toBeVisible();

  let previousCount = -1;
  let stableCount = await rows.count();
  const deadline = Date.now() + 10_000;

  while (previousCount !== stableCount && Date.now() < deadline) {
    previousCount = stableCount;
    await page.waitForTimeout(250);
    stableCount = await rows.count();
  }

  expect(stableCount, 'grid row count did not settle').toBe(previousCount);
  return stableCount;
}
