import { expect, test } from '@playwright/test';
import { setupUserWithoutProjects } from './utils';

test.use({ locale: 'fr-FR', viewport: { width: 1440, height: 900 } });

test('sign-in and password changes show French messages', async ({ page, request }) => {
  const credentials = await setupUserWithoutProjects(request, 'auth-localization-password-change');
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  const password = page.getByLabel(/^Mot de passe\s*\*?$/);
  const signIn = page.getByRole('button', { name: 'Se connecter', exact: true });
  await page.getByLabel('E-mail').fill(credentials.email);
  await password.fill('wrong fixture password');
  await signIn.click();
  await expect(page.getByRole('alert')).toHaveText('La connexion avec les identifiants saisis a échoué.');

  await password.fill(credentials.password);
  await signIn.click();
  await expect(page).toHaveURL(/\/app\//);
  await page.goto('/app/account-settings');
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click();

  const newPassword = 'Synthetic account passphrase 2026!';
  const current = page.getByLabel('Mot de passe actuel');
  const save = page.getByRole('button', { name: 'Enregistrer le mot de passe' });
  await current.fill('wrong fixture password');
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(newPassword);
  await page.getByLabel('Répéter le nouveau mot de passe').fill(newPassword);
  await save.click();
  await expect(page.getByText('Votre mot de passe actuel est incorrect.', { exact: true })).toBeVisible();

  await current.fill(credentials.password);
  await save.click();
  await expect(page.getByText('Votre mot de passe a été modifié.', { exact: true })).toBeVisible();
  await expect(current).not.toBeVisible();
});

test('password-reset requests give the same French confirmation for both addresses', async ({ page, request }) => {
  const credentials = await setupUserWithoutProjects(request, 'auth-localization-reset-request');

  for (const email of [credentials.email, 'absent-auth-localization@example.com']) {
    await page.goto('/forgot-password');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await page.getByLabel('E-mail').fill(email);
    await page.getByRole('button', { name: "Envoyer l'e-mail de réinitialisation" }).click();
    await expect(page.getByRole('alert')).toHaveText('Si le compte existe, nous avons envoyé un e-mail de réinitialisation.');
  }
});
