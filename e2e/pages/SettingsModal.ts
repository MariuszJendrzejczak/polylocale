import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the Settings modal: manages AI provider keys and the
 * passphrase. The modal is opened from the topbar gear button (label
 * "Open settings"), but the topbar lives on the `EditorPage` POM —
 * callers do `await editor.settingsButton.click()` first.
 *
 * Provider rows are identified by their label (`DeepL`, `OpenAI`,
 * `Anthropic`). Each row renders status text ("Configured · ••••…1234"
 * or "Not configured") plus an action button: "Add key" when empty,
 * "Replace" / "Delete" when configured. The status is exposed through
 * an `aria-label` on the status pill so we can assert via role.
 *
 * The passphrase change form lives at the bottom of the modal. The
 * three inputs are labelled `Current passphrase`, `New passphrase`,
 * `Confirm new passphrase`.
 */
export class SettingsModal {
  constructor(public readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog', { name: 'Settings' });
  }

  get title(): Locator {
    return this.root.getByRole('heading', { name: 'Settings' });
  }

  get closeButton(): Locator {
    return this.root.getByRole('button', { name: 'Close settings' });
  }

  /**
   * Locate the row for a provider. Each row carries a status pill with
   * an `aria-label` of the form `<Label>: configured` /
   * `<Label>: not configured`. We anchor on the pill (unique inside
   * the dialog) and walk up to the enclosing row.
   */
  providerRow(label: 'DeepL' | 'OpenAI' | 'Anthropic'): Locator {
    const statusPill = this.root.locator(
      `[aria-label="${label}: configured"], [aria-label="${label}: not configured"]`,
    );
    return statusPill.locator('xpath=..');
  }

  /**
   * Boolean status of a provider slot. Reads the `aria-label` we set on
   * the status pill, which avoids coupling to the visible text shape
   * (which embeds the masked tail of the key).
   */
  async isConfigured(label: 'DeepL' | 'OpenAI' | 'Anthropic'): Promise<boolean> {
    const ariaLabel = await this.root
      .locator(`[aria-label="${label}: configured"], [aria-label="${label}: not configured"]`)
      .first()
      .getAttribute('aria-label');
    return ariaLabel === `${label}: configured`;
  }

  /** Click "Add key" (or "Replace") on a provider row. */
  async addKey(label: 'DeepL' | 'OpenAI' | 'Anthropic'): Promise<void> {
    const row = this.providerRow(label);
    // "Add key" when empty, "Replace" when already configured.
    const button = row.getByRole('button', { name: /^(Add key|Replace)$/ });
    await button.click();
  }

  /** Click Delete + confirm. */
  async deleteKey(label: 'DeepL' | 'OpenAI' | 'Anthropic'): Promise<void> {
    const row = this.providerRow(label);
    await row.getByRole('button', { name: 'Delete' }).click();
    // Inline confirmation row replaces the "Replace / Delete" pair.
    await row.getByRole('button', { name: 'Delete' }).click();
  }

  // ----- passphrase form -----

  get openPassphraseFormButton(): Locator {
    return this.root.getByRole('button', { name: 'Change passphrase…' });
  }

  get currentPassphraseInput(): Locator {
    return this.root.getByLabel('Current passphrase');
  }

  get newPassphraseInput(): Locator {
    return this.root.getByLabel('New passphrase', { exact: true });
  }

  get confirmPassphraseInput(): Locator {
    return this.root.getByLabel('Confirm new passphrase');
  }

  get submitPassphraseButton(): Locator {
    return this.root.getByRole('button', { name: 'Change passphrase' });
  }

  async changePassphrase(current: string, next: string): Promise<void> {
    await this.openPassphraseFormButton.click();
    await this.currentPassphraseInput.fill(current);
    await this.newPassphraseInput.fill(next);
    await this.confirmPassphraseInput.fill(next);
    await this.submitPassphraseButton.click();
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }
}
