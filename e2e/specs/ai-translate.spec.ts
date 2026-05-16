/**
 * Group C — AI translation.
 *
 * C1: Per-cell ✦ accept lands a value tagged with `source: 'ai'`.
 * C2: Per-row "Translate missing" with partial accept — only checked rows land.
 * C3: Fill missing for locale with mid-flight abort — nothing mutates.
 * C4: UnsupportedLocaleError surfaces as a skipped row (DeepL → mt-MT).
 * C5: Passphrase cancel is silent (no banner, no popover, no pending entry).
 *
 * Every scenario installs `mockProviders` in `beforeEach`. The mock
 * appends `[<targetLocale>]` to each fragment; this lets the spec
 * assert on the exact text the SPA renders without knowing anything
 * about the provider mapping.
 */

import { expect, test } from '@playwright/test';

import { mockProviders } from '../mocks/ai.js';
import { ApiKeyPrompt } from '../pages/ApiKeyPrompt.js';
import { BatchProgressModal } from '../pages/BatchProgressModal.js';
import { BatchReviewModal } from '../pages/BatchReviewModal.js';
import { EditorPage } from '../pages/EditorPage.js';
import { PassphrasePrompt } from '../pages/PassphrasePrompt.js';
import { resetAppState } from '../utils/idb.js';
import { TEST_PASSPHRASE } from '../utils/passphrase.js';

test.describe('C. AI translation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetAppState(page);
    await page.goto('/');
    await mockProviders(page, { deepl: true, openai: true, anthropic: true });
  });

  test('C1 — per-cell ✦ accept writes the suggestion to the cell', async ({ page }) => {
    const editor = new EditorPage(page);
    const passphrase = new PassphrasePrompt(page);
    const apiKey = new ApiKeyPrompt(page);
    await editor.openFiles('with-missing');

    // The pl column is missing `home`, `homeSubtitle`, `save`. Click ✦
    // on the `home` row — the secret store is locked the first time,
    // so the passphrase gate fires before the API-key prompt.
    await editor.cellSuggestButton('home', 'pl').click();
    await passphrase.unlock(TEST_PASSPHRASE);
    await apiKey.submit('deepl-test-key:fx');

    // Popover lands on `ready`. Accept; the cell now reads the mocked
    // translation (`Home [PL]`).
    const popover = editor.suggestionPopover;
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: 'Accept' }).click();

    await expect(editor.cell('home', 'pl')).toContainText('Home [PL]');
    // The cell no longer renders the "missing" badge.
    await expect(editor.cell('home', 'pl')).not.toContainText(/missing/i);
  });

  test('C2 — per-row Translate missing with partial accept', async ({ page }) => {
    const editor = new EditorPage(page);
    const passphrase = new PassphrasePrompt(page);
    const apiKey = new ApiKeyPrompt(page);
    const review = new BatchReviewModal(page);
    await editor.openFiles('with-missing');

    // Run the batch on `home` — pl is the only target locale and it is
    // missing for that key, so we get exactly one outcome.
    await editor.triggerRowTranslateMissing('home');
    await passphrase.unlock(TEST_PASSPHRASE);
    await apiKey.submit('deepl-test-key:fx');

    // The review modal opens with one ready outcome. Uncheck it and the
    // Apply button disables; check again and apply.
    await expect(review.root).toBeVisible();
    await expect(review.rowCheckbox('home', 'pl')).toBeChecked();

    // Add a second outcome by triggering a different row — we want to
    // exercise the partial-accept path properly. Close + re-run on
    // `homeSubtitle`. Each batch is scoped to its own modal.
    await review.close();
    await editor.triggerRowTranslateMissing('homeSubtitle');

    await expect(review.root).toBeVisible();
    // Single outcome again; uncheck it before applying → nothing lands.
    await review.uncheck('homeSubtitle', 'pl');
    await expect(review.applyButton).toBeDisabled();

    // Cancel the unchecked batch — homeSubtitle stays missing.
    await review.close();
    await expect(editor.cell('homeSubtitle', 'pl')).toContainText(/missing/i);

    // Re-run on `home`, this time apply the row → it lands.
    await editor.triggerRowTranslateMissing('home');
    await expect(review.root).toBeVisible();
    await review.applySelected();
    await expect(editor.cell('home', 'pl')).toContainText('Home [PL]');
  });

  test('C3 — fill missing for locale with mid-flight abort', async ({ page }) => {
    const editor = new EditorPage(page);
    const passphrase = new PassphrasePrompt(page);
    const apiKey = new ApiKeyPrompt(page);
    const progress = new BatchProgressModal(page);
    await editor.openFiles('with-missing');

    // Slow the DeepL mock so we can race the Cancel click against
    // job completion. The default mock answers instantly; here we
    // delay each /v2/translate by 1 s.
    await page.route('**/v2/translate', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        text?: readonly string[];
        target_lang?: string;
      };
      const target = body.target_lang ?? 'XX';
      const translations = (body.text ?? []).map((t) => ({
        text: `${t} [${target}]`,
        detected_source_language: 'EN',
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ translations }),
      });
    });

    await editor.fillMissingForLocale('pl');
    await passphrase.unlock(TEST_PASSPHRASE);
    await apiKey.submit('deepl-test-key:fx');

    // Progress modal opens. Cancel mid-flight.
    await expect(progress.root).toBeVisible();
    await progress.cancel();

    // The progress modal closes; no review modal opens; no rows mutated.
    await expect(progress.root).toHaveCount(0);
    await expect(editor.cell('home', 'pl')).toContainText(/missing/i);
    await expect(editor.cell('homeSubtitle', 'pl')).toContainText(/missing/i);
    await expect(editor.cell('save', 'pl')).toContainText(/missing/i);
  });

  test('C4 — UnsupportedLocaleError surfaces as skipped', async ({ page }) => {
    const editor = new EditorPage(page);
    const passphrase = new PassphrasePrompt(page);
    const apiKey = new ApiKeyPrompt(page);
    const review = new BatchReviewModal(page);
    await editor.openFiles('with-unsupported');

    // DeepL doesn't support mt-MT — the adapter throws
    // UnsupportedLocaleError before any HTTP call leaves the SPA.
    // Every job lands as `skipped-unsupported`.
    await editor.fillMissingForLocale('mt-MT');
    await passphrase.unlock(TEST_PASSPHRASE);
    await apiKey.submit('deepl-test-key:fx');

    await expect(review.root).toBeVisible();
    // Every checkbox is disabled (no ready outcomes) and the reason
    // line carries the unsupported message.
    const checkboxes = review.allCheckboxes;
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeDisabled();
    }
    await expect(review.root).toContainText(/skipped: deepl: target locale "mt-MT"/);
    await expect(review.applyButton).toBeDisabled();
  });

  test('C5 — passphrase cancel is silent', async ({ page }) => {
    const editor = new EditorPage(page);
    const passphrase = new PassphrasePrompt(page);
    await editor.openFiles('with-missing');

    // Cold state: the secret store is locked. Click ✦ on a missing
    // cell → passphrase prompt opens. Press Escape.
    await editor.cellSuggestButton('home', 'pl').click();
    await expect(passphrase.root).toBeVisible();
    await passphrase.pressEscape();

    // The passphrase prompt is gone. No API-key prompt, no popover,
    // no banner, and the cell stays missing.
    await expect(passphrase.root).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /API key$/ })).toHaveCount(0);
    await expect(editor.suggestionPopover).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(editor.cell('home', 'pl')).toContainText(/missing/i);
  });
});
