/**
 * Group G — Translator handoff.
 *
 * G1: CSV round-trip with three buckets — clean / conflict / parse error.
 *     We pre-bake the edited CSV next to the source fixture so the
 *     surface is reviewable side-by-side (`handoff/source/` +
 *     `handoff/edit.csv`). Applying the checked rows funnels through
 *     `setValuesBatch`; the test asserts the edited cells now read the
 *     applied value back.
 *
 * G2: Cleared-cell conflict renders inert. The translator emptied a
 *     previously-set pl cell; the row lands in the Conflicts bucket
 *     with no checkbox and the hint copy from ARCHITECTURE §6.4
 *     ("translator cleared this cell …").
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { EditorPage } from '../pages/EditorPage.js';
import { HandoffModal } from '../pages/HandoffModal.js';
import { resetAppState } from '../utils/idb.js';
import { readDownload } from '../utils/file-system.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EDIT_CSV = path.resolve(here, '..', 'fixtures', 'handoff', 'edit.csv');

test.describe('G. Translator handoff', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetAppState(page);
    await page.goto('/');
  });

  test('G1 — CSV export → modify → import → three buckets → apply', async ({ page }) => {
    const editor = new EditorPage(page);
    const handoff = new HandoffModal(page);
    await editor.openFiles('handoff/source');

    // Sanity: the source project loaded with the expected starting
    // state. `home/pl` is missing, `save/pl` is "Zapisz".
    await expect(editor.cell('home', 'pl')).toContainText(/missing/i);
    await expect(editor.cell('save', 'pl')).toContainText('Zapisz');

    // Export → capture the download so the spec covers the "translator
    // got a real CSV out of the app" leg of the round-trip.
    await editor.handoffButton.click();
    await expect(handoff.root).toBeVisible();
    const download = await handoff.exportCsv();
    const exported = await readDownload(download);
    expect(exported.text).toContain('key,description,en,pl');
    expect(exported.text).toContain('home');
    expect(exported.text).toContain('save');

    // Import the pre-baked edited CSV: 1 clean (home/pl="Dom"),
    // 1 conflict (save/pl="Zachowaj"), 1 parse error
    // (greeting/pl malformed ICU). Numbers reflect the committed
    // fixture under `e2e/fixtures/handoff/`.
    await handoff.importCsv(EDIT_CSV);

    await expect(handoff.cleanRows).toHaveCount(1);
    await expect(handoff.conflictRows).toHaveCount(1);
    await expect(handoff.parseErrorRows).toHaveCount(1);

    // The clean checkbox defaults to checked; the conflict checkbox
    // defaults to unchecked. Force-applying the conflict lets us prove
    // that ticking the checkbox routes the conflict through the same
    // setValuesBatch as the clean apply.
    await expect(handoff.cleanCheckbox('home', 'pl')).toBeChecked();
    await expect(handoff.conflictCheckbox('save', 'pl')).not.toBeChecked();
    await handoff.conflictCheckbox('save', 'pl').check();

    // Parse-error rows are read-only.
    await expect(handoff.parseErrorRows.first()).toContainText('greeting');
    await expect(handoff.parseErrorRows.first()).toContainText('parse-error');

    await handoff.applySelected();
    await expect(handoff.root).toHaveCount(0);

    // The applied rows now read their CSV values back. The unparsable
    // greeting cell stayed put.
    await expect(editor.cell('home', 'pl')).toContainText('Dom');
    await expect(editor.cell('save', 'pl')).toContainText('Zachowaj');
    await expect(editor.cell('greeting', 'pl')).toContainText('Witaj {name}');
  });

  test('G2 — cleared-cell conflict renders inert with the §6.4 hint', async ({ page }) => {
    const editor = new EditorPage(page);
    const handoff = new HandoffModal(page);
    await editor.openFiles('handoff/source');

    await editor.handoffButton.click();
    await expect(handoff.root).toBeVisible();

    // A translator-cleared cell is `pl` empty for a key that was set.
    // We import this directly via the hidden file input — no need to
    // commit a second fixture, the shape is tiny and one-shot.
    const CRLF = '\r\n';
    const lines = [
      'key,description,en,pl',
      'save,,Save,', // pl emptied; was "Zapisz" in source
    ];
    const csv = lines.join(CRLF) + CRLF;
    await handoff.importCsvBuffer('cleared.csv', csv);

    await expect(handoff.conflictRows).toHaveCount(1);
    const clearedRow = handoff.conflictRow('save', 'pl');
    await expect(clearedRow).toBeVisible();

    // The cleared row exposes no Force-apply checkbox.
    await expect(handoff.conflictCheckbox('save', 'pl')).toHaveCount(0);

    // The hint text matches ARCHITECTURE §6.4. We anchor on a stable
    // substring rather than the full sentence so future copy tweaks
    // are forgiving.
    await expect(clearedRow).toContainText(/translator cleared this cell/i);

    // Apply is disabled — there is nothing to apply.
    await expect(handoff.applyButton).toBeDisabled();
  });
});
