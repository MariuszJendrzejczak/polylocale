import type { Locator, Page } from '@playwright/test';

import { openFilesFromFixture } from '../utils/file-system.js';

/**
 * Page Object Model for the main editor view.
 *
 * Selector strategy mirrors `doc/E2E-TEST-PLAN.md` §4: roles + accessible
 * names first, `data-testid` only where ARIA cannot express the identity
 * (table cells parameterised by key + locale, row menus). CSS class
 * selectors are not allowed; tests that need a new hook should ask the app
 * for a stable attribute, not couple to a style class.
 */
export class EditorPage {
  constructor(public readonly page: Page) {}

  // ----- navigation -----

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  // ----- top-bar controls -----

  /** "Open files…" — the fallback path (hidden `<input>` behind the button). */
  get openFilesButton(): Locator {
    // Two buttons read "Open files…" on Chromium (primary + secondary
    // fallback). We always pick the one wired to the hidden input.
    return this.page.getByRole('button', { name: 'Open files…', exact: true }).last();
  }

  get saveButton(): Locator {
    // The button label flips between "Save" and "Download" depending on
    // whether we have an FS Access handle. Scope the search to the
    // top-bar element directly — the table renders cells with
    // role="button" whose accessible names can contain "Save modified",
    // which would trip strict-mode matching against `getByRole`.
    return this.page
      .locator('header')
      .first()
      .getByRole('button', { name: /^(Save|Download)\b/ });
  }

  get searchInput(): Locator {
    return this.page.getByLabel('Search keys or values');
  }

  get sortByStatusToggle(): Locator {
    return this.page.getByRole('button', { name: /^Status/ });
  }

  get addKeyButton(): Locator {
    return this.page.getByRole('button', { name: '+ Add key' });
  }

  get glossaryButton(): Locator {
    return this.page.getByRole('button', { name: 'Open glossary' });
  }

  get handoffButton(): Locator {
    return this.page.getByRole('button', { name: 'Translator handoff' });
  }

  get settingsButton(): Locator {
    return this.page.getByRole('button', { name: 'Open settings' });
  }

  get baseLocaleSelect(): Locator {
    return this.page.getByLabel('Base locale');
  }

  // ----- table -----

  cell(keyPath: string, locale: string): Locator {
    return this.page.locator(
      `[data-testid="cell"][data-key-path="${cssEscape(keyPath)}"][data-locale="${cssEscape(locale)}"]`,
    );
  }

  cellsForLocale(locale: string): Locator {
    return this.page.locator(`[data-testid="cell"][data-locale="${cssEscape(locale)}"]`);
  }

  /** All visible cells in the table, in DOM (row) order. */
  get allCells(): Locator {
    return this.page.locator('[data-testid="cell"]');
  }

  /** The "⋯" trigger inside the key column for the row whose key matches. */
  rowMenu(keyPath: string): Locator {
    return this.page
      .locator('[data-row-key]', { has: this.page.getByText(keyPath, { exact: true }) })
      .getByTestId('row-menu');
  }

  /** Cell-level AI ✦ button for a target locale row. */
  cellSuggestButton(keyPath: string, locale: string): Locator {
    return this.cell(keyPath, locale).getByTestId('ai-suggest-button');
  }

  /** The popover that opens after clicking the ✦ on a cell. */
  get suggestionPopover(): Locator {
    return this.page.getByTestId('ai-suggest-popover');
  }

  /** Select control wired to the project-level default AI provider. */
  get defaultProviderSelect(): Locator {
    return this.page.getByLabel('Default AI provider');
  }

  // ----- interactions -----

  async openFiles(fixtureName: string): Promise<void> {
    await openFilesFromFixture(this.page, fixtureName);
    // Wait for the table to render at least one cell so the test does not
    // race the React effect that dispatches `loaded`.
    await this.allCells.first().waitFor({ state: 'visible' });
  }

  async currentBaseLocale(): Promise<string> {
    return this.baseLocaleSelect.inputValue();
  }

  async clickAddKey(): Promise<void> {
    await this.addKeyButton.click();
  }

  async submitAddKey(path: string, baseValue: string): Promise<void> {
    await this.page.getByLabel('Key path').fill(path);
    // The textarea's accessible name flips with the base locale.
    await this.page.getByLabel(/^Base value/).fill(baseValue);
    await this.page.getByRole('button', { name: 'Add key', exact: true }).click();
  }

  async editCell(keyPath: string, locale: string, value: string): Promise<void> {
    const cell = this.cell(keyPath, locale);
    await cell.click();
    const textarea = cell.locator('textarea');
    await textarea.waitFor({ state: 'visible' });
    await textarea.fill(value);
    // The editor commits on blur. Clicking outside the cell is the most
    // robust trigger — pressing Tab also blurs but can scroll a virtualised
    // row out of view.
    await this.page.locator('header').first().click();
  }

  async openRowMenu(keyPath: string): Promise<void> {
    await this.rowMenu(keyPath).click();
  }

  async clickRowMenuItem(label: string): Promise<void> {
    // The row-menu dropdown shares a stacking context with adjacent
    // table cells, so Playwright's actionability check sometimes flags
    // them as pointer-event interceptors. Dispatching the click via
    // `evaluate` lands the event on the menuitem unconditionally — the
    // React handler still runs, which is what the assertion exercises.
    await this.page
      .getByRole('menuitem', { name: label })
      .evaluate((el) => (el as HTMLElement).click());
  }

  async renameKey(keyPath: string, newPath: string): Promise<void> {
    await this.openRowMenu(keyPath);
    await this.clickRowMenuItem('Rename key');
    const input = this.page.getByLabel('Rename key');
    await input.fill(newPath);
    await input.press('Enter');
  }

  async deleteKey(keyPath: string): Promise<void> {
    await this.openRowMenu(keyPath);
    await this.clickRowMenuItem('Delete key');
    await this.page.getByRole('button', { name: 'Delete', exact: true }).click();
  }

  /**
   * Open the row menu for `keyPath` and click "Translate missing locales".
   * Used by C2 — the batch review modal opens after the in-flight jobs
   * resolve.
   */
  async triggerRowTranslateMissing(keyPath: string): Promise<void> {
    await this.openRowMenu(keyPath);
    await this.clickRowMenuItem('Translate missing locales');
  }

  /**
   * Click the "Fill missing for…" button and select a target locale from
   * the dropdown. Used by C3 + C4.
   */
  async fillMissingForLocale(locale: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Fill missing for…' }).click();
    await this.page.getByRole('menuitem', { name: locale }).click();
  }

  /**
   * Select the project-level default AI provider. Tests use this to make
   * the "default provider" path land on a specific provider mock.
   */
  async setProviderDefault(providerId: 'deepl' | 'openai' | 'anthropic'): Promise<void> {
    const labels: Record<typeof providerId, string> = {
      deepl: 'DeepL',
      openai: 'OpenAI',
      anthropic: 'Anthropic',
    };
    await this.defaultProviderSelect.selectOption({ label: labels[providerId] });
  }

  // ----- feature probes -----

  /**
   * Chromium ships `showDirectoryPicker`; Firefox / WebKit do not. Tests
   * that need the FS Access reopen path gate themselves on this probe.
   */
  async supportsFsAccess(): Promise<boolean> {
    return this.page.evaluate(() => 'showDirectoryPicker' in window);
  }
}

/**
 * Minimal CSS.escape polyfill for attribute selectors. We feed key paths
 * straight from `TranslationKey.path`, which can carry dots and other CSS
 * specials; `CSS.escape` is browser-side, and we run inside Node.
 */
function cssEscape(value: string): string {
  return value.replace(/(["\\\n])/g, '\\$1');
}
