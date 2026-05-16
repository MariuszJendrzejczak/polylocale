import type { Page } from '@playwright/test';

/**
 * Wipe the SPA's persistent client state so each test starts from a known
 * blank slate. Call inside `beforeEach`, after `page.goto(...)` has loaded
 * the app origin (IndexedDB is per-origin and requires an active document
 * to delete).
 *
 * Polylocale uses two IndexedDB databases:
 *   - `polylocale-editor`  — directory handle + project meta + glossary
 *   - `polylocale-secrets` — AES-GCM-encrypted API keys + KDF salt + verifier
 *
 * Plus `localStorage` / `sessionStorage`, which the app does not currently
 * write to but which any future feature might reach for. Clearing both is
 * cheap and keeps the test boundary stable.
 */
export async function resetAppState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dbs = ['polylocale-editor', 'polylocale-secrets'];
    await Promise.all(
      dbs.map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          }),
      ),
    );
    try {
      localStorage.clear();
    } catch {
      // SecurityError in some private contexts; safe to ignore.
    }
    try {
      sessionStorage.clear();
    } catch {
      // Same as above.
    }
  });
}
