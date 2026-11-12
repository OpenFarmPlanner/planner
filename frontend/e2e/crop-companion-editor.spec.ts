import { expect, test } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

type SavedCrop = { id: number; name: string };
type Relation = { id: number; crop: number; companion_crop: number; kind: string; note: string };

for (const width of [375, 1440]) {
  test(`shared companion editor creates, moves and removes reciprocal pairs at ${width}px`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, `companion-editor-${width}`, { loginAsAdmin: true });
    const owner = await apiRequest<SavedCrop>(page, 'POST', '/crops/', { name: 'Editor owner' });
    const neighbor = await apiRequest<SavedCrop>(page, 'POST', '/crops/', { name: 'Editor neighbor' });
    const variety = await apiRequest<SavedCrop>(page, 'POST', '/crops/', { name: owner.name, variety: 'Shared variety' });
    await page.goto(`/app/crops?cropId=${variety.id}`);
    await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
    const section = page.getByTestId('crop-companions-section');
    await section.getByRole('button', { name: 'Nachbarn hinzufügen', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Mischkultur bearbeiten', exact: true });
    await expect(dialog).toContainText('Gilt für alle Sorten von Editor owner.');
    await dialog.getByRole('button', { name: 'Guten Nachbarn hinzufügen' }).click();
    await dialog.getByRole('combobox', { name: 'Nachbar', exact: true }).fill(neighbor.name);
    await page.getByRole('option', { name: neighbor.name, exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Shared source');
    await page.screenshot({ path: testInfo.outputPath(`companion-create-${width}.png`), animations: 'disabled' });
    if (width === 375) {
      await page.route('**/api/crop-companions/replace/', route => route.fulfill({ status: 500, json: { detail: 'Simulated write failure' } }));
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText('Die Nachbarn konnten nicht gespeichert werden. Deine Änderungen bleiben erhalten.');
      await expect(dialog.getByRole('textbox', { name: 'Notiz', exact: true })).toHaveValue('Shared source');
      await page.screenshot({ path: testInfo.outputPath(`companion-save-retry-${width}.png`), animations: 'disabled' });
      await page.unroute('**/api/crop-companions/replace/');
    }
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();
    let relations = await apiRequest<Relation[]>(page, 'GET', '/crop-companions/');
    expect(relations).toHaveLength(1);
    expect([relations[0].crop, relations[0].companion_crop].sort()).toEqual([owner.id, neighbor.id].sort());
    expect(relations[0].kind).toBe('good');
    await section.getByRole('button', { name: neighbor.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`cropId=${neighbor.id}(?:&|$)`));
    await expect(section.getByRole('button', { name: owner.name, exact: true })).toBeVisible();

    await section.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Mischkultur bearbeiten', exact: true });
    await expect(dialog.getByTestId('companion-compact-row')).toContainText(owner.name);
    await expect(dialog.getByRole('combobox', { name: 'Nachbar', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`companion-compact-${width}.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: `${owner.name} bearbeiten`, exact: true }).click();
    await dialog.getByRole('button', { name: 'Zu den schlechten Nachbarn verschieben' }).click();
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();
    relations = await apiRequest<Relation[]>(page, 'GET', '/crop-companions/');
    expect(relations).toHaveLength(1);
    expect(relations[0].kind).toBe('bad');
    expect(relations[0].note).toBe('Shared source');
    await expect(section.getByTestId('companion-kind-bad')).toContainText(owner.name);

    await section.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Mischkultur bearbeiten', exact: true });
    await dialog.getByRole('button', { name: 'Nachbar entfernen' }).click();
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await apiRequest<Relation[]>(page, 'GET', '/crop-companions/')).toEqual([]);
    await page.goto(`/app/crops?cropId=${variety.id}`);
    await expect(section.getByRole('button', { name: 'Nachbarn hinzufügen', exact: true })).toBeVisible();
    await expect(section.getByText(neighbor.name, { exact: true })).toHaveCount(0);
  });
}
