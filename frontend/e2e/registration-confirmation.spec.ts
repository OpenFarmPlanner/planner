import { expect, test, type Page } from '@playwright/test';
import { setupUserWithoutProjects, VIEWPORTS } from './utils';

const PASSWORD = 'e2e-safe-password-123';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByRole('textbox', { name: 'E-Mail' }).fill(email);
  const passwordInputs = page.locator('input[autocomplete="new-password"]');
  await passwordInputs.nth(0).fill(PASSWORD);
  await passwordInputs.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByText('Klicke auf den Link darin, um dein Konto zu bestätigen.', { exact: false })).toBeVisible();
}

test('confirmation page shows the address, the spam hint and a rate-limited resend', async ({ page }) => {
  const email = uniqueEmail('e2e-register-confirm');
  await register(page, email);

  await expect(page.locator('strong', { hasText: email })).toBeVisible();
  await expect(page.getByText(/Schau bitte auch im Spam-Ordner nach.*Die E-Mail kommt von \S+@\S+\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Konto erstellen' })).toHaveCount(0);

  const resendButton = page.getByRole('button', { name: 'E-Mail erneut senden' });
  const resendResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/resend-activation/'));
  await resendButton.click();
  expect((await resendResponse).status()).toBe(200);

  await expect(page.getByText('Wir haben die E-Mail erneut gesendet.')).toBeVisible();
  await expect(resendButton).toBeDisabled();
  await expect(page.getByText(/Erneut senden ist in \d+ s möglich\./)).toBeVisible();

  await page.getByRole('button', { name: 'Adresse falsch? Neu registrieren' }).click();
  await expect(page.getByRole('button', { name: 'Konto erstellen' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'E-Mail' })).toHaveValue(email);
});

test('confirmation page shows the limit message when the hourly resend cap is reached', async ({ page }) => {
  await page.route('**/api/auth/resend-activation/', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '1800' },
      body: JSON.stringify({ code: 'activation_resend_limit_reached', detail: 'limit', retry_after: 1800 }),
    }),
  );
  await register(page, uniqueEmail('e2e-register-limit'));

  const resendButton = page.getByRole('button', { name: 'E-Mail erneut senden' });
  await resendButton.click();

  await expect(
    page.getByText('Du hast die maximale Anzahl an Versuchen erreicht. Bitte versuche es später noch einmal.'),
  ).toBeVisible();
  await expect(resendButton).toBeDisabled();
});

test('confirmation page fits every breakpoint without horizontal scrolling', async ({ page }) => {
  await register(page, uniqueEmail('e2e-register-a-rather-long-address-to-check-wrapping'));

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByRole('button', { name: 'E-Mail erneut senden' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${viewport.key}`).toBeLessThanOrEqual(0);
  }
});

test('login with an unconfirmed account offers the spam hint and resend', async ({ page }) => {
  const email = uniqueEmail('e2e-register-login');
  await register(page, email);

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail' }).fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Das Konto ist noch nicht aktiviert.' })).toHaveText(
    'Das Konto ist noch nicht aktiviert.',
  );
  await expect(page.getByText(/Schau bitte auch im Spam-Ordner nach.*Die E-Mail kommt von \S+@\S+\./)).toBeVisible();
  await page.getByRole('button', { name: 'E-Mail erneut senden' }).click();
  await expect(page.getByText('Wir haben die E-Mail erneut gesendet.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('logged-in notice keeps both actions fully visible without horizontal scrolling', async ({ page, request }, testInfo) => {
  const user = await setupUserWithoutProjects(request, `register-logged-in-${testInfo.workerIndex}`);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail' }).fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/app\//);
  await page.goto('/register');

  const primary = page.getByRole('button', { name: 'Abmelden & neuen Account erstellen' });
  const secondary = page.getByRole('button', { name: 'Zur App zurückkehren' });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(primary).toBeVisible();
    await expect(secondary).toBeVisible();

    const layout = await primary.evaluate((primaryButton) => {
      const secondaryButton = primaryButton.nextElementSibling as HTMLElement;
      const message = primaryButton.closest('.MuiAlert-message') as HTMLElement;
      const notice = primaryButton.closest('.MuiAlert-root') as HTMLElement;
      const card = notice.parentElement?.closest('.MuiPaper-root') as HTMLElement;
      const text = message.querySelector('.MuiTypography-root') as HTMLElement;
      const box = (element: Element) => element.getBoundingClientRect();
      const overflows = (element: HTMLElement) => element.scrollWidth > element.clientWidth;
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cardOverflows: overflows(card),
        messageOverflows: overflows(message),
        labelsClipped: overflows(primaryButton) || overflows(secondaryButton),
        textLeft: box(text).left,
        messageRight: box(message).right,
        primary: box(primaryButton).toJSON() as DOMRect,
        secondary: box(secondaryButton).toJSON() as DOMRect,
      };
    });
    const at = `at ${viewport.key}`;

    expect(layout.pageOverflow, `page overflow ${at}`).toBeLessThanOrEqual(0);
    expect(layout.cardOverflows, `card overflow ${at}`).toBe(false);
    expect(layout.messageOverflows, `notice overflow ${at}`).toBe(false);
    expect(layout.labelsClipped, `clipped label ${at}`).toBe(false);
    expect(layout.primary.left, `buttons aligned with the text ${at}`).toBeCloseTo(layout.textLeft, 0);
    expect(layout.secondary.right, `buttons inside the notice ${at}`).toBeLessThanOrEqual(layout.messageRight + 0.5);

    if (layout.primary.top === layout.secondary.top) {
      expect(layout.secondary.left, `side-by-side buttons ${at}`).toBeGreaterThan(layout.primary.right);
    } else {
      expect(layout.secondary.top, `primary action on top ${at}`).toBeGreaterThan(layout.primary.bottom);
      expect(layout.secondary.left, `stacked buttons share the left edge ${at}`).toBeCloseTo(layout.primary.left, 0);
      expect(layout.primary.width, `stacked buttons fill the notice ${at}`).toBeCloseTo(layout.messageRight - layout.textLeft, 0);
      expect(layout.secondary.width, `stacked buttons fill the notice ${at}`).toBeCloseTo(layout.primary.width, 0);
    }
  }
});
