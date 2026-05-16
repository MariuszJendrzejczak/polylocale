import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the modal that unlocks the AES-GCM-encrypted secret
 * store. Fires the first time any AI flow touches the store and again
 * after every reload until the user unlocks.
 *
 * Identification is purely ARIA: the dialog has the title
 * "Unlock secret store" and the input is labelled "Passphrase". No
 * `data-testid` is needed.
 */
export class PassphrasePrompt {
  constructor(public readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog', { name: 'Unlock secret store' });
  }

  get input(): Locator {
    return this.root.getByLabel('Passphrase');
  }

  get unlockButton(): Locator {
    return this.root.getByRole('button', { name: /^unlock$/i });
  }

  get cancelButton(): Locator {
    return this.root.getByRole('button', { name: 'Cancel' });
  }

  async unlock(passphrase: string): Promise<void> {
    await this.input.fill(passphrase);
    await this.unlockButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  /** Dismiss the modal with the Escape key — used by C5. */
  async pressEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }
}
