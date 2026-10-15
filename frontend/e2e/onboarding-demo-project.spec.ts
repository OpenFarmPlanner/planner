import { expect, test, type Page } from '@playwright/test';
import { setupUserWithoutProjects, waitForPageStable } from './utils';

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

test.describe('first-project onboarding', () => {
  test('creates and opens a personal demo project from the onboarding screen', async ({ page, request }, testInfo) => {
    const user = await setupUserWithoutProjects(request, `onboarding-demo-${testInfo.workerIndex}`);

    await login(page, user.email, user.password);

    await expect(page).toHaveURL(/\/app\/project-selection/);
    await expect(page.getByRole('button', { name: 'Demo-Projekt erstellen' })).toBeVisible();
    await page.getByRole('button', { name: 'Demo-Projekt erstellen' }).focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/app\/fields-beds/);
    await expect(page.getByText('Dieses Projekt enthält Beispieldaten.')).toBeVisible();
    await expect(page.locator('.project-switcher-label', { hasText: 'Solawi Sonnenacker' })).toBeVisible();
    await expect(page.getByText('Acker am Bach')).toBeVisible();
    await expect(page.getByText('Karotten 1')).toBeVisible();

    await page.goto('/app/seed-demand');
    await waitForPageStable(page, /Saatgutbedarf/);
    await expect(page.getByText('Karotte')).toBeVisible();

    await page.goto('/app/crops');
    await waitForPageStable(page, /Kulturbibliothek/);
    await expect(page.getByRole('heading', { name: 'Brokkoli' })).toBeVisible();
  });

  test('keeps the empty-project path available from onboarding', async ({ page, request }, testInfo) => {
    const user = await setupUserWithoutProjects(request, `onboarding-empty-${testInfo.workerIndex}`);

    await login(page, user.email, user.password);

    await expect(page).toHaveURL(/\/app\/project-selection/);
    await page.getByRole('button', { name: 'Leeres Projekt anlegen' }).click();
    await expect(page.getByRole('heading', { name: 'Projekt anlegen' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Projektname' })).toBeFocused();
  });
});
