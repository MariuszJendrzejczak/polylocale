/**
 * Group F — Diff view.
 *
 * F1: A structural placeholder mismatch ({count} vs {n}) shows up in the
 *     Diff tab with the "structural mismatch" badge. Clicking the row
 *     switches back to the Editor tab and scrolls the matching row
 *     into view.
 *
 * The fixture (`with-mismatch/`) is shaped so the divergence on
 * `itemCount` is the only structural one — `greeting` shares the same
 * `{name}` placeholder across locales, `appTitle` and `save` are plain
 * text. That keeps the assertion crisp: exactly one mismatch row, not
 * "find the one in the list".
 */

import { expect, test } from '@playwright/test';

import { DiffView } from '../pages/DiffView.js';
import { EditorPage } from '../pages/EditorPage.js';
import { resetAppState } from '../utils/idb.js';

test.describe('F. Diff view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetAppState(page);
    await page.goto('/');
  });

  test('F1 — structural mismatch surfaces and click-through scrolls to the row', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    const diff = new DiffView(page);
    await editor.openFiles('with-mismatch');

    // Sanity: the editor renders both locales for itemCount before we
    // switch into the Diff tab.
    await expect(editor.cell('itemCount', 'en')).toBeVisible();
    await expect(editor.cell('itemCount', 'pl')).toBeVisible();

    await diff.open();
    expect(await diff.leftLocale()).toBe('en');
    expect(await diff.rightLocale()).toBe('pl');

    // Exactly one structural-mismatch row, and it's `itemCount`.
    const mismatchRows = diff.rowsWithBadge('structural mismatch');
    await expect(mismatchRows).toHaveCount(1);
    await expect(mismatchRows.first()).toContainText('itemCount');

    // `greeting` shares the {name} placeholder across locales, so it
    // must not surface as a diff row.
    await expect(diff.rows.filter({ hasText: 'greeting' })).toHaveCount(0);

    // Clicking the row returns to the editor tab and scrolls the
    // matching row into view.
    await diff.clickRow('itemCount');
    await expect(page.getByRole('tab', { name: 'Editor', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const targetCell = editor.cell('itemCount', 'pl');
    await expect(targetCell).toBeInViewport();
  });
});
