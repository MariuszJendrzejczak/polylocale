import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the Glossary modal.
 *
 * The modal is opened from the topbar 📖 Glossary button on the editor
 * (label "Open glossary") — callers do `await editor.glossaryButton.click()`
 * first. The view is a `role="dialog"` titled "Glossary" with one
 * row per glossary entry. Each entry exposes:
 *
 *   - the term as an `<input>` labelled `Term <term>` (because the
 *     accessible name flips when the user is mid-edit, the POM keys off
 *     the *original* term value),
 *   - a per-locale translation input labelled `<locale> translation`,
 *   - a per-locale "Don't translate <locale>" checkbox,
 *   - a Delete button labelled `Delete <term>` with an inline confirm
 *     pair (Cancel / Delete) after the first click.
 *
 * "+ Add term" inserts a new entry with a synthesized term ("new term",
 * "new term 2", …) so we can address it afterwards. Filter / search is
 * the only top-level control with a stable label
 * ("Search glossary terms").
 */
export class GlossaryModal {
  constructor(public readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog', { name: 'Glossary' });
  }

  get title(): Locator {
    return this.root.getByRole('heading', { name: 'Glossary' });
  }

  get closeButton(): Locator {
    return this.root.getByRole('button', { name: 'Close glossary' });
  }

  get searchInput(): Locator {
    return this.root.getByLabel('Search glossary terms');
  }

  get addTermButton(): Locator {
    return this.root.getByRole('button', { name: '+ Add term' });
  }

  /**
   * Locator scoped to one entry row.
   *
   * Per-locale aria-labels (`pl translation`, `Don't translate pl`)
   * are *not* unique across entries — multiple glossary entries each
   * render those labels. The Notes textarea, however, has a
   * term-scoped accessible name (`Notes for <term>`), so any div that
   * contains both the term input and the notes textarea wraps exactly
   * this entry.
   *
   * Two ancestor divs match in DOM order — the outer body wrapper
   * (which hosts every entry) and the entry's own wrapper. With a
   * single entry both have exactly one `<locale> translation` input,
   * but with multiple entries the body wrapper has one per entry and
   * trips strict-mode lookups. `last()` selects the innermost wrapper
   * so the per-locale lookups stay unique.
   *
   * Playwright's `filter({ has })` evaluates the inner Locator as a
   * descendant of each candidate; if that inner Locator carries
   * ancestor-scope of its own (`this.root.getByLabel(...)` →
   * "dialog/Glossary → input"), the candidate `<div>` doesn't have
   * the dialog as a descendant and the match returns nothing — so we
   * use page-scoped Locators inside `has`.
   */
  entry(term: string): Locator {
    return this.root
      .locator('div')
      .filter({ has: this.page.getByLabel(`Term ${term}`, { exact: true }) })
      .filter({ has: this.page.getByLabel(`Notes for ${term}`, { exact: true }) })
      .last();
  }

  /** Term input inside a row. */
  termInput(term: string): Locator {
    return this.root.getByLabel(`Term ${term}`, { exact: true });
  }

  /**
   * Per-locale translation input for a given entry.
   *
   * The view labels the input as `${locale} translation` only — the
   * accessible name does not carry the term. With multiple entries in
   * play we scope through `entry(term)`; with a single entry the
   * dialog-wide lookup is unambiguous either way.
   */
  translationInput(term: string, locale: string): Locator {
    return this.entry(term).getByLabel(`${locale} translation`, { exact: true });
  }

  /** Per-locale "Don't translate" toggle (see `translationInput` caveat). */
  doNotTranslateToggle(term: string, locale: string): Locator {
    return this.entry(term).getByLabel(`Don't translate ${locale}`, { exact: true });
  }

  /** Notes textarea for an entry. */
  notesInput(term: string): Locator {
    return this.root.getByLabel(`Notes for ${term}`, { exact: true });
  }

  /** Delete trigger inside the row. */
  deleteButton(term: string): Locator {
    return this.entry(term).getByRole('button', { name: `Delete ${term}`, exact: true });
  }

  /** Confirm-delete button that replaces the trigger after the first click. */
  confirmDeleteButton(term: string): Locator {
    // Once the user clicks "Delete <term>", the trigger is replaced by an
    // inline Cancel / Delete pair; the confirm button has a plain
    // accessible name "Delete" (no term suffix).
    return this.entry(term).getByRole('button', { name: 'Delete', exact: true });
  }

  // ----- high-level actions -----

  /**
   * Add a new entry through the toolbar and rename it to `term`. The
   * modal creates a placeholder term so the row has a stable identity
   * before the rename; we commit the new term by blurring the input.
   */
  async addTerm(term: string): Promise<void> {
    await this.addTermButton.click();
    // The newly added entry is anchored on "new term" (the modal's
    // candidate generator picks the first free slot starting at "new
    // term"). Edit it to the requested name and blur to commit.
    const placeholder = this.termInput('new term');
    await placeholder.fill(term);
    await placeholder.press('Enter');
  }

  /**
   * Set the per-locale translation for an existing entry. The reducer
   * commits on blur, so we explicitly blur the input after filling.
   * Pressing Enter would also work (the modal wires Enter → blur), but
   * a plain Tab leaves no lingering keydown listener for adjacent
   * handlers (the Glossary modal listens on `document` for Escape).
   */
  async setTranslation(term: string, locale: string, value: string): Promise<void> {
    const input = this.translationInput(term, locale);
    await input.fill(value);
    await input.blur();
  }

  /** Rename an entry. */
  async editTerm(oldTerm: string, newTerm: string): Promise<void> {
    const input = this.termInput(oldTerm);
    await input.fill(newTerm);
    await input.press('Enter');
  }

  /** Remove an entry through the inline-confirm flow. */
  async removeTerm(term: string): Promise<void> {
    await this.deleteButton(term).click();
    await this.confirmDeleteButton(term).click();
  }

  async filter(query: string): Promise<void> {
    await this.searchInput.fill(query);
  }

  /** Number of entries currently visible in the body. */
  async list(): Promise<readonly string[]> {
    const inputs = this.root.locator('input[aria-label^="Term "]');
    const count = await inputs.count();
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const value = await inputs.nth(i).inputValue();
      out.push(value);
    }
    return out;
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }
}
