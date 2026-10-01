import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type InviteFixture = {
  projectName: string;
  projectSlug: string;
  inviteToken: string;
  inviteUrl: string;
  invitee: { email: string; password: string };
  outsider: { email: string; password: string };
  admin: { email: string; password: string };
};

// Must default to the same BACKEND_PORT used to configure the backend webServer in
// playwright.config.ts, or fixture setup silently hits whatever else happens to be
// running on port 8000 (e.g. a developer's own long-running dev backend) instead of
// the backend actually under test.
const defaultBackendPort = process.env.BACKEND_PORT ?? '8000';
const e2eApiBase =
  process.env.PLAYWRIGHT_E2E_API_BASE ??
  `http://127.0.0.1:${defaultBackendPort}/api/__e2e__/invite-flow/`;
const e2eToken = process.env.E2E_TEST_TOKEN || 'openfarmplanner-e2e-token';

async function invokeE2EAction(
  request: APIRequestContext,
  action: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await request.post(e2eApiBase, {
    headers: { 'X-E2E-Token': e2eToken },
    data: { action, ...payload },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Record<string, unknown>;
}

async function setupInviteFixture(
  request: APIRequestContext,
  scenarioId: string,
  invitationState: 'pending' | 'accepted' | 'revoked' = 'pending',
): Promise<InviteFixture> {
  await invokeE2EAction(request, 'reset', { scenario_id: scenarioId });
  return (await invokeE2EAction(request, 'setup', {
    scenario_id: scenarioId,
    invitation_state: invitationState,
  })) as InviteFixture;
}

async function removeInviteeMembership(
  request: APIRequestContext,
  scenarioId: string,
): Promise<void> {
  await invokeE2EAction(request, 'remove_member', { scenario_id: scenarioId });
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('E-Mail').fill(email);
  // getByLabel('Passwort') also matches the MUI show/hide password toggle button
  // (aria-label "Passwort anzeigen"), so scope directly to the password input.
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

test.describe('project invitation flow', () => {
  test('continues invite context through login and accepts the invitation', async ({ page, request }, testInfo) => {
    const scenarioId = `invite-login-${testInfo.workerIndex}`;
    const fixture = await setupInviteFixture(request, scenarioId);

    await page.goto(fixture.inviteUrl);
    await expect(page).toHaveURL(/\/login\?next=/);

    await loginViaUi(page, fixture.invitee.email, fixture.invitee.password);

    await expect(page).toHaveURL(/\/app\/fields-beds/);
    await expect(page.getByText(fixture.projectName)).toBeVisible();
  });

  test('keeps the new login when an anonymous request sent before it is answered after it', async ({ page, request }, testInfo) => {
    // Regression: logging in rotates the session. An anonymous request that
    // left the browser before the login but was handled after it used to come
    // back deleting the session cookie — the *new* one — so every request
    // after accepting the invitation failed with 403 and the user landed on
    // /login (an intermittent CI failure of the test above).
    const scenarioId = `invite-late-anonymous-${testInfo.workerIndex}`;
    const fixture = await setupInviteFixture(request, scenarioId);
    const loginAnswered = page.waitForResponse((response) => response.url().includes('/api/auth/login/'));
    const invitationAccepted = page.waitForResponse((response) => /\/api\/project-invitations\/[^/]+\/accept\/$/.test(new URL(response.url()).pathname));
    let heldOnce = false;
    await page.route('**/api/project-invitations/pending/', async (route) => {
      if (heldOnce) {
        await route.continue();
        return;
      }
      heldOnce = true;
      const anonymousCookies = (await page.context().cookies())
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
      await loginAnswered;
      const lateResponse = await route.fetch({ headers: { ...route.request().headers(), cookie: anonymousCookies } });
      await invitationAccepted;
      await route.fulfill({ response: lateResponse });
    });

    await page.goto(fixture.inviteUrl);
    await expect(page).toHaveURL(/\/login\?next=/);
    await loginViaUi(page, fixture.invitee.email, fixture.invitee.password);

    await expect(page).toHaveURL(/\/app\/fields-beds/);
    await expect(page.getByText(fixture.projectName)).toBeVisible();
  });

  test('rejects a second use of the same invitation link with a clear error state', async ({ page, request }, testInfo) => {
    const scenarioId = `invite-reuse-${testInfo.workerIndex}`;
    const fixture = await setupInviteFixture(request, scenarioId);

    await page.goto(fixture.inviteUrl);
    await loginViaUi(page, fixture.invitee.email, fixture.invitee.password);
    await expect(page).toHaveURL(/\/app\/fields-beds/);
    await expect(page.getByText(fixture.projectName)).toBeVisible();

    await page.goto(fixture.inviteUrl);
    await expect(page.getByText('Diese Einladung wurde bereits verwendet.')).toBeVisible();
  });

  test('does not allow rejoin through an old link after the member was removed', async ({ page, request }, testInfo) => {
    const scenarioId = `invite-remove-${testInfo.workerIndex}`;
    const fixture = await setupInviteFixture(request, scenarioId);

    await page.goto(fixture.inviteUrl);
    await loginViaUi(page, fixture.invitee.email, fixture.invitee.password);
    await expect(page).toHaveURL(/\/app\/fields-beds/);
    await expect(page.getByText(fixture.projectName)).toBeVisible();

    await removeInviteeMembership(request, scenarioId);

    await page.goto(fixture.inviteUrl);
    await expect(page.getByText('Diese Einladung wurde bereits verwendet.')).toBeVisible();
  });

  test('shows a clear mismatch error for the wrong logged-in user', async ({ page, request }, testInfo) => {
    const scenarioId = `invite-mismatch-${testInfo.workerIndex}`;
    const fixture = await setupInviteFixture(request, scenarioId);

    await page.goto(fixture.inviteUrl);
    await loginViaUi(page, fixture.outsider.email, fixture.outsider.password);

    await expect(
      page.getByText(
        `Diese Einladung ist für ${maskEmail(fixture.invitee.email)} bestimmt, du bist aber als ${fixture.outsider.email} eingeloggt.`,
      ),
    ).toBeVisible();
  });

  test('shows a safe terminal error for revoked and invalid invitation links', async ({ page, request }, testInfo) => {
    const scenarioId = `invite-revoked-${testInfo.workerIndex}`;
    const revokedFixture = await setupInviteFixture(request, scenarioId, 'revoked');

    await page.goto(revokedFixture.inviteUrl);
    await expect(page.getByText('Diese Einladung wurde widerrufen.')).toBeVisible();

    await page.goto('/invite/accept?token=this-token-does-not-exist');
    await expect(page.getByText('Ungültiger Einladungslink.')).toBeVisible();
  });
});
