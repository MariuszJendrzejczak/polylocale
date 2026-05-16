/**
 * Group B — Search, sort, key CRUD.
 *
 * B1: Search filters and clears.
 * B2: Sort by status surfaces missing first.
 * B3: Add key with ICU placeholder.
 * B4: Rename key — old path gone, new path present, save reflects rename.
 * B5: Delete key — row gone, save omits the path entirely.
 */

import { expect, test } from '@playwright/test';

import { EditorPage } from '../pages/EditorPage.js';
import { resetAppState } from '../utils/idb.js';
import { clickAndCaptureDownloads, readDownload } from '../utils/file-system.js';

test.describe('B. Search, sort, key CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetAppState(page);
    await page.goto('/');
  });

  test('B1 — search filters rows and restores them when cleared', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.openFiles('basic-arb');

    await expect(editor.cell('home', 'en')).toBeVisible();
    await expect(editor.cell('save', 'en')).toBeVisible();

    await editor.searchInput.fill('home');

    await expect(editor.cell('home', 'en')).toBeVisible();
    await expect(editor.cell('homeSubtitle', 'en')).toBeVisible();
    await expect(editor.cell('save', 'en')).toHaveCount(0);
    await expect(editor.cell('appTitle', 'en')).toHaveCount(0);

    await editor.searchInput.fill('');
    await expect(editor.cell('save', 'en')).toBeVisible();
    await expect(editor.cell('appTitle', 'en')).toBeVisible();
  });

  test('B2 — sort by status surfaces missing rows first', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.openFiles('with-missing');

    // In the with-missing fixture, en is complete and pl is missing
    // home, homeSubtitle, save. Aggregate status of those three rows is
    // worse than appTitle / greeting; sorting asc should pull them up.
    await editor.sortByStatusToggle.click();

    const cells = editor.cellsForLocale('pl');
    await expect(cells.first()).toBeVisible();
    const topKeys = await editor.page.evaluate(() => {
      // Project the first three rendered cells (pl column) onto their
      // key paths so we can assert order without coupling to a specific
      // tie-break inside the comparator.
      const nodes = Array.from(
        document.querySelectorAll('[data-testid="cell"][data-locale="pl"]'),
      ).slice(0, 3);
      return nodes.map((n) => (n as HTMLElement).dataset['keyPath'] ?? '');
    });
    expect(new Set(topKeys)).toEqual(new Set(['home', 'homeSubtitle', 'save']));
  });

  test('B3 — add key with ICU placeholder creates a row', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.openFiles('basic-arb');

    await editor.clickAddKey();
    await editor.submitAddKey('appSubtitle', 'Welcome, {name}');

    await expect(editor.cell('appSubtitle', 'en')).toBeVisible();
    await expect(editor.cell('appSubtitle', 'en')).toContainText('Welcome, {name}');
    // Other locales are missing — the badge label "missing" shows up
    // inside the pl cell for the new key.
    await expect(editor.cell('appSubtitle', 'pl')).toContainText(/missing/i);
  });

  test('B4 — rename key updates the model and the exported files', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.openFiles('basic-arb');

    await editor.renameKey('appTitle', 'appName');

    await expect(editor.cell('appName', 'en')).toBeVisible();
    await expect(editor.cell('appTitle', 'en')).toHaveCount(0);

    const downloads = await clickAndCaptureDownloads(page, editor.saveButton);
    expect(downloads.length).toBeGreaterThan(0);
    for (const dl of downloads) {
      const { text } = await readDownload(dl);
      expect(text).toContain('"appName"');
      // The old top-level translation key must be gone. `appTitle` may
      // still appear inside metadata blocks of other keys (it doesn't,
      // for this fixture, but be defensive): match only top-level keys.
      expect(text).not.toMatch(/^\s*"appTitle":/m);
    }
  });

  test('B5 — delete key removes the row and excludes it from exports', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.openFiles('basic-arb');

    await editor.deleteKey('save');

    await expect(editor.cell('save', 'en')).toHaveCount(0);

    const downloads = await clickAndCaptureDownloads(page, editor.saveButton);
    expect(downloads.length).toBeGreaterThan(0);
    for (const dl of downloads) {
      const { text } = await readDownload(dl);
      expect(text).not.toMatch(/^\s*"save":/m);
    }
  });
});
