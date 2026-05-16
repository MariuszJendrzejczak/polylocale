import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the batch translation review modal.
 *
 * The modal opens after a batch run completes (per-row "Translate
 * missing locales" or "Fill missing for <locale>"). Each outcome row
 * carries a checkbox (label: `Apply <keyPath> <locale>`) and a status
 * line. Skipped and errored rows render with a disabled checkbox plus
 * a "skipped: …" or "failed: …" reason.
 *
 * Identification is ARIA-first. The dialog is `role="dialog"` with a
 * matching `aria-labelledby` heading; the Apply button carries
 * `data-testid="batch-apply"` because its accessible name flips with
 * the selected count (`Apply 3 selected`).
 */
export class BatchReviewModal {
  constructor(public readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog').filter({ has: this.page.getByTestId('batch-apply') });
  }

  /** Heading text — varies per flow (e.g. "Fill missing for pl"). */
  get title(): Locator {
    return this.root.getByRole('heading', { level: 2 });
  }

  /** Apply button — disabled when no row is selected. */
  get applyButton(): Locator {
    return this.root.getByTestId('batch-apply');
  }

  get cancelButton(): Locator {
    return this.root.getByRole('button', { name: 'Cancel' });
  }

  /**
   * Per-row checkbox. Label is set by the view to
   * `Apply <keyPath> <locale>`; using ARIA is enough — no testid needed.
   */
  rowCheckbox(keyPath: string, locale: string): Locator {
    return this.root.getByRole('checkbox', { name: `Apply ${keyPath} ${locale}` });
  }

  /** All visible checkboxes — used to count outcomes by sum. */
  get allCheckboxes(): Locator {
    return this.root.getByRole('checkbox');
  }

  async uncheck(keyPath: string, locale: string): Promise<void> {
    await this.rowCheckbox(keyPath, locale).uncheck();
  }

  async check(keyPath: string, locale: string): Promise<void> {
    await this.rowCheckbox(keyPath, locale).check();
  }

  async applySelected(): Promise<void> {
    await this.applyButton.click();
  }

  async close(): Promise<void> {
    await this.cancelButton.click();
  }
}
