import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the per-provider API-key prompt. Opens whenever a
 * translation flow targets a provider whose slot is empty (and the
 * secret store is unlocked).
 *
 * The dialog title flips with the provider — `<Label> API key` — so we
 * locate by the dialog's `aria-labelledby` heading via a regex match
 * (`/API key$/`). The input is labelled "API key".
 */
export class ApiKeyPrompt {
  constructor(public readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog', { name: /API key$/ });
  }

  get input(): Locator {
    return this.root.getByLabel('API key');
  }

  get saveButton(): Locator {
    return this.root.getByRole('button', { name: /save key/i });
  }

  get cancelButton(): Locator {
    return this.root.getByRole('button', { name: 'Cancel' });
  }

  async submit(apiKey: string): Promise<void> {
    await this.input.fill(apiKey);
    await this.saveButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }
}
