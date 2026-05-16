/**
 * Group D — Settings and secret store.
 *
 * D1: Add key via Settings → translate uses it without re-prompting.
 * D2: Delete key → translate re-prompts for the API key.
 * D3: Passphrase rotation survives a reload; translations succeed under
 *     the new passphrase without re-prompting for the key.
 */

import { expect, test } from '@playwright/test';

import { mockProviders } from '../mocks/ai.js';
import { ApiKeyPrompt } from '../pages/ApiKeyPrompt.js';
import { EditorPage } from '../pages/EditorPage.js';
import { PassphrasePrompt } from '../pages/PassphrasePrompt.js';
import { SettingsModal } from '../pages/SettingsModal.js';
import { resetAppState } from '../utils/idb.js';
import { TEST_PASSPHRASE, TEST_PASSPHRASE_ROTATED } from '../utils/passphrase.js';

test.describe('D. Settings and secret store', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetAppState(page);
    await page.goto('/');
    await mockProviders(page, { deepl: true, openai: true, anthropic: true });
  });

  test('D1 — add OpenAI key via Settings; translate uses it without re-prompt', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    const passphrase = new PassphrasePrompt(page);
    const apiKey = new ApiKeyPrompt(page);
    const settings = new SettingsModal(page);
    await editor.openFiles('with-missing');

    // Open Settings → unlock store on the way.
    await editor.settingsButton.click();
    await passphrase.unlock(TEST_PASSPHRASE);
    await expect(settings.root).toBeVisible();

    // Add the OpenAI key. The slot flips to "configured".
    expect(await settings.isConfigured('OpenAI')).toBe(false);
    await settings.addKey('OpenAI');
    await apiKey.submit('sk-test-openai-key');
    await expect.poll(() => settings.isConfigured('OpenAI')).toBe(true);
    await settings.close();

    // Route the next translation through OpenAI by switching the
    // project default. The cell ✦ uses `effectiveProvider(... locale)`
    // which falls back to the project default when no per-locale
    // override is set.
    await editor.setProviderDefault('openai');

    // Click ✦ on a missing cell — no API-key prompt should open,
    // and the popover should land on `ready`.
    await editor.cellSuggestButton('home', 'pl').click();
    await expect(apiKey.root).toHaveCount(0);
    const popover = editor.suggestionPopover;
    await expect(popover).toBeVisible();
    // The popover shows the provider it used in the footer.
    await expect(popover).toContainText(/OpenAI/);
    await popover.getByRole('button', { name: 'Accept' }).click();
    await expect(editor.cell('home', 'pl')).toContainText('Home [pl]');
  });

  test('D2 — deleting a key re-prompts on the next translate', async ({ page }) => {
    const editor = new EditorPage(page);
    const passphrase = new PassphrasePrompt(page);
    const apiKey = new ApiKeyPrompt(page);
    const settings = new SettingsModal(page);
    await editor.openFiles('with-missing');

    // Seed OpenAI through the Settings flow.
    await editor.settingsButton.click();
    await passphrase.unlock(TEST_PASSPHRASE);
    await settings.addKey('OpenAI');
    await apiKey.submit('sk-test-openai-key');
    await expect.poll(() => settings.isConfigured('OpenAI')).toBe(true);

    // Delete the OpenAI slot. After the inline-confirm round-trip the
    // status flips back to "not configured".
    await settings.deleteKey('OpenAI');
    await expect.poll(() => settings.isConfigured('OpenAI')).toBe(false);
    await settings.close();

    // Switch default to OpenAI and trigger a translate — the API-key
    // prompt opens because the slot is empty again. The host caches
    // adapter instances per slot key, so this also exercises the cache
    // invalidation that the Settings modal triggers via `onSlotMutated`.
    await editor.setProviderDefault('openai');
    await editor.cellSuggestButton('home', 'pl').click();
    await expect(apiKey.root).toBeVisible();
  });

  test('D3 — passphrase rotation survives reload', async ({ page }) => {
    const editor = new EditorPage(page);
    const passphrase = new PassphrasePrompt(page);
    const apiKey = new ApiKeyPrompt(page);
    const settings = new SettingsModal(page);
    await editor.openFiles('with-missing');

    // Seed three slots under the original passphrase.
    await editor.settingsButton.click();
    await passphrase.unlock(TEST_PASSPHRASE);
    await expect(settings.root).toBeVisible();

    await settings.addKey('DeepL');
    await apiKey.submit('deepl-test-key:fx');
    await expect.poll(() => settings.isConfigured('DeepL')).toBe(true);

    await settings.addKey('OpenAI');
    await apiKey.submit('sk-test-openai-key');
    await expect.poll(() => settings.isConfigured('OpenAI')).toBe(true);

    await settings.addKey('Anthropic');
    await apiKey.submit('sk-test-anthropic-key');
    await expect.poll(() => settings.isConfigured('Anthropic')).toBe(true);

    // Rotate the passphrase from the same modal.
    await settings.changePassphrase(TEST_PASSPHRASE, TEST_PASSPHRASE_ROTATED);
    await expect(settings.root.getByRole('status')).toContainText('Passphrase updated.');
    await settings.close();

    // Reload — the unlock prompt fires again on the first AI action.
    await page.reload();
    await editor.openFiles('with-missing');

    // We exercise one round-trip per provider against three different
    // missing cells. The unlock prompt appears once on the first click
    // and only then.
    const targets = [
      { providerId: 'deepl', keyPath: 'home', suffix: '[PL]' },
      { providerId: 'openai', keyPath: 'homeSubtitle', suffix: '[pl]' },
      { providerId: 'anthropic', keyPath: 'save', suffix: '[pl]' },
    ] as const;

    let unlocked = false;
    for (const t of targets) {
      await editor.setProviderDefault(t.providerId);
      await editor.cellSuggestButton(t.keyPath, 'pl').click();
      if (!unlocked) {
        await expect(passphrase.root).toBeVisible();
        await passphrase.unlock(TEST_PASSPHRASE_ROTATED);
        unlocked = true;
      }
      // The api-key prompt must NOT fire — the rotation preserved
      // every slot.
      await expect(apiKey.root).toHaveCount(0);
      const popover = editor.suggestionPopover;
      await expect(popover).toBeVisible();
      await popover.getByRole('button', { name: 'Accept' }).click();
      await expect(editor.cell(t.keyPath, 'pl')).toContainText(t.suffix);
    }
  });
});
