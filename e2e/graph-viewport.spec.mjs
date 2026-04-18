import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelPath = path.resolve(__dirname, '../public/resources/testmodel.ifc');

async function loadTestModel(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles(modelPath);
  await expect(page.locator('body')).toContainText('File: testmodel.ifc', { timeout: 180000 });
  await expect(page.getByText('Loaded status')).toBeVisible({ timeout: 180000 });
  await expect(page.getByRole('button', { name: 'Open graph viewport' })).toBeEnabled({ timeout: 180000 });
}

test('graph viewport popup is fullscreen and stays synced with the data table', async ({ page }) => {
  await loadTestModel(page);

  const [graphPage] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Open graph viewport' }).click(),
  ]);
  await graphPage.waitForLoadState('domcontentloaded');
  await expect(graphPage.getByRole('heading', { name: 'Element Relationships' })).toBeVisible();

  const graphBounds = await graphPage.locator('section').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });

  expect(graphBounds.width).toBeGreaterThanOrEqual(graphBounds.innerWidth - 2);
  expect(graphBounds.height).toBeGreaterThanOrEqual(graphBounds.innerHeight - 2);

  await graphPage.waitForFunction(() => {
    const text = document.body.innerText;
    const match = text.match(/(\d+) rendered/);
    return match ? Number(match[1]) >= 7 : false;
  }, { timeout: 180000 });

  const visibleText = await graphPage.locator('body').innerText();
  const visibleMatch = visibleText.match(/(\d+) rendered/);
  expect(visibleMatch).toBeTruthy();
  expect(Number(visibleMatch[1])).toBeGreaterThanOrEqual(7);

  const [dataTablePage] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Open data table' }).click(),
  ]);
  await dataTablePage.waitForLoadState('domcontentloaded');
  await expect(dataTablePage.locator('tbody tr').first()).toBeVisible({ timeout: 180000 });

  const selectedBefore = await graphPage.locator('body').innerText();
  expect(selectedBefore).toContain('No element selected.');

  await dataTablePage.locator('tbody tr').first().click();
  await expect(page.locator('body')).toContainText('Selected:', { timeout: 30000 });
  await expect(graphPage.locator('body')).not.toContainText('No element selected.', { timeout: 30000 });

  const graphNodes = graphPage.locator('svg g[role="button"][aria-label^="Select "]');
  await expect(graphNodes.first()).toBeVisible();
  const nodeCount = await graphNodes.count();
  expect(nodeCount).toBeGreaterThan(1);

  await graphNodes.nth(1).click();
  await expect(page.locator('body')).toContainText('Selected:', { timeout: 30000 });
  await expect(dataTablePage.locator('tbody tr').first()).toBeVisible();

  await Promise.all([graphPage.close(), dataTablePage.close()]);
});
