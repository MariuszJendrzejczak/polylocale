import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the Diff view (Editor → Diff tab).
 *
 * The view is mounted by clicking the `Diff` tab on the editor topbar.
 * It carries two locale selects (`Diff left locale`, `Diff right locale`)
 * and a `role="list"` of divergent keys. Each row is a `role="listitem"`
 * button rendering: the key path, the left and right cell text, and a
 * badge whose `data-reason` is one of `missing`, `empty`,
 * `structural mismatch`.
 *
 * Clicking a row dispatches `setView: editor` and scrolls the editor
 * table to the matching row (via `data-row-key`).
 */
export type DiffReason = 'missing' | 'empty' | 'structural mismatch';

export class DiffView {
  constructor(public readonly page: Page) {}

  /** Switch the editor into the Diff tab. */
  async open(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Diff', exact: true }).click();
    // Wait for the left-locale select to materialise so the test doesn't
    // race the React render that mounts the view.
    await this.leftLocaleSelect.waitFor({ state: 'visible' });
  }

  get leftLocaleSelect(): Locator {
    return this.page.getByLabel('Diff left locale', { exact: true });
  }

  get rightLocaleSelect(): Locator {
    return this.page.getByLabel('Diff right locale', { exact: true });
  }

  async leftLocale(): Promise<string> {
    return this.leftLocaleSelect.inputValue();
  }

  async rightLocale(): Promise<string> {
    return this.rightLocaleSelect.inputValue();
  }

  async setLeftLocale(locale: string): Promise<void> {
    await this.leftLocaleSelect.selectOption(locale);
  }

  async setRightLocale(locale: string): Promise<void> {
    await this.rightLocaleSelect.selectOption(locale);
  }

  /** Every divergent row, in render order. */
  get rows(): Locator {
    return this.page.getByRole('listitem');
  }

  /** Rows that carry the given badge reason. */
  rowsWithBadge(reason: DiffReason): Locator {
    return this.rows.filter({ has: this.page.locator(`[data-reason="${reason}"]`) });
  }

  /** Click a divergent row by its key path. */
  async clickRow(keyPath: string): Promise<void> {
    const row = this.rows.filter({ hasText: keyPath }).first();
    await row.click();
  }
}
