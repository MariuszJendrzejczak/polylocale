import type { Download, Locator, Page } from '@playwright/test';

/**
 * Page Object for the Translator handoff modal.
 *
 * Opened from the topbar 📤 Translator button on the editor (label
 * "Translator handoff") — callers do `await editor.handoffButton.click()`
 * first. The modal exposes a Download CSV button, an Upload CSV trigger
 * (which fires the hidden `<input type="file" aria-label="Upload
 * translator CSV">`), and three buckets:
 *
 *   - clean applies  → `data-testid="handoff-row-clean"`     (checkbox per row, default checked)
 *   - conflicts      → `data-testid="handoff-row-conflict"`  (checkbox per row, default unchecked;
 *                                                            cleared-cell rows have no checkbox)
 *   - parse errors   → `data-testid="handoff-row-parseError"` (read-only)
 *
 * The Apply button's accessible name flips with the selected count
 * ("Apply 3 selected"); we anchor on the regex `^Apply.*selected$`.
 */
export class HandoffModal {
  constructor(public readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog', { name: 'Translator handoff' });
  }

  get title(): Locator {
    return this.root.getByRole('heading', { name: 'Translator handoff' });
  }

  get downloadButton(): Locator {
    return this.root.getByRole('button', { name: 'Download CSV' });
  }

  get uploadButton(): Locator {
    return this.root.getByRole('button', { name: 'Upload CSV…' });
  }

  /** The hidden file input the Upload button triggers. */
  get uploadInput(): Locator {
    return this.root.getByLabel('Upload translator CSV');
  }

  get applyButton(): Locator {
    return this.root.getByRole('button', { name: /^Apply (?:\d+ )?selected$/ });
  }

  get cancelButton(): Locator {
    return this.root.getByRole('button', { name: 'Cancel', exact: true });
  }

  // ----- bucket locators -----

  get cleanRows(): Locator {
    return this.root.getByTestId('handoff-row-clean');
  }

  get conflictRows(): Locator {
    return this.root.getByTestId('handoff-row-conflict');
  }

  get parseErrorRows(): Locator {
    return this.root.getByTestId('handoff-row-parseError');
  }

  cleanCheckbox(keyPath: string, locale: string): Locator {
    return this.root.getByRole('checkbox', { name: `Apply ${keyPath} ${locale}` });
  }

  conflictCheckbox(keyPath: string, locale: string): Locator {
    return this.root.getByRole('checkbox', { name: `Force apply ${keyPath} ${locale}` });
  }

  /** Locate a single conflict row by its key/locale by anchoring on its text. */
  conflictRow(keyPath: string, locale: string): Locator {
    return this.conflictRows.filter({ hasText: keyPath }).filter({ hasText: locale });
  }

  // ----- actions -----

  /**
   * Click Download CSV and capture the resulting download. The handoff
   * blob is emitted synchronously via an anchor + URL.createObjectURL,
   * so `waitForEvent('download')` resolves immediately.
   */
  async exportCsv(): Promise<Download> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.downloadButton.click(),
    ]);
    return download;
  }

  /**
   * Upload a CSV by writing it directly to the hidden file input. The
   * modal handles the triage; the test reads the resulting bucket
   * locators to assert what landed where.
   */
  async importCsv(filePath: string): Promise<void> {
    await this.uploadInput.setInputFiles(filePath);
  }

  /** Same as `importCsv` but with inline buffer content. */
  async importCsvBuffer(filename: string, text: string): Promise<void> {
    await this.uploadInput.setInputFiles({
      name: filename,
      mimeType: 'text/csv',
      buffer: Buffer.from(text, 'utf8'),
    });
  }

  async applySelected(): Promise<void> {
    await this.applyButton.click();
  }

  async close(): Promise<void> {
    await this.cancelButton.click();
  }
}
