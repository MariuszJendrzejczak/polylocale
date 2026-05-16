import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the in-flight batch progress modal.
 *
 * Used by C3 to abort a batch mid-flight. The Cancel button carries
 * both `data-testid="batch-cancel"` (because the BatchReviewModal also
 * exposes a "Cancel" button under the same dialog role) and an
 * accessible `aria-label="Cancel translation batch"` so an assistive
 * tech user can tell the two apart.
 */
export class BatchProgressModal {
  constructor(public readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog').filter({ has: this.page.getByTestId('batch-cancel') });
  }

  /** Title — varies per flow (e.g. "Fill missing for pl"). */
  get title(): Locator {
    return this.root.locator('div').first();
  }

  get cancelButton(): Locator {
    return this.root.getByTestId('batch-cancel');
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }
}
