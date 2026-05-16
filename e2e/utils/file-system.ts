import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Download, Locator, Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(here, '..', 'fixtures');

/**
 * Absolute path to a fixture directory inside `e2e/fixtures/`. Tests pass
 * fixture names ("basic-arb", "with-missing", …); the harness resolves them
 * against the repo so the same path works locally and in CI.
 */
export function fixturePath(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

/**
 * List every locale file (.arb / .json, sorted) inside a fixture directory.
 * Used by `openFilesFromFixture` to feed `setInputFiles` deterministically.
 */
export async function listFixtureFiles(name: string): Promise<readonly string[]> {
  const dir = fixturePath(name);
  const entries = await fs.readdir(dir);
  return entries
    .filter((f) => f.endsWith('.arb') || f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Open a fixture through the fallback `<input type="file" multiple>` path —
 * which is the same code path Firefox/Safari users hit in the wild. Works in
 * every browser, including Chromium where `showDirectoryPicker` would
 * otherwise pop up a real OS picker the test cannot drive.
 *
 * Wiring:
 *   - The `Open files…` button triggers a hidden `<input>` click. We pre-set
 *     the input's files with `setInputFiles` before clicking; the input has
 *     `display: none`, so Playwright won't try to scroll it into view.
 */
export async function openFilesFromFixture(page: Page, name: string): Promise<void> {
  const files = await listFixtureFiles(name);
  if (files.length === 0) {
    throw new Error(`fixture "${name}" has no locale files (expected .arb / .json)`);
  }
  const input = page.locator('input[type="file"][accept*=".arb"]');
  await input.setInputFiles(files);
}

/**
 * Save a `download` event to a fresh temp file and return both the absolute
 * path and the decoded UTF-8 text. Playwright's `download.path()` works in
 * the trace viewer + CI without us needing to pick a directory.
 */
export async function readDownload(download: Download): Promise<{
  readonly path: string;
  readonly text: string;
}> {
  const filePath = await download.path();
  if (filePath === null) {
    throw new Error(`download "${download.suggestedFilename()}" produced no on-disk path`);
  }
  const text = await fs.readFile(filePath, 'utf8');
  return { path: filePath, text };
}

/**
 * Click a save button and capture all download events that fire as a result.
 * The fallback save path can emit multiple downloads (one per locale file);
 * we wait for the first one synchronously and drain the rest via a listener
 * so the test sees every blob.
 */
export async function clickAndCaptureDownloads(
  page: Page,
  trigger: Locator,
): Promise<readonly Download[]> {
  const downloads: Download[] = [];
  const off = (d: Download): void => {
    downloads.push(d);
  };
  page.on('download', off);
  try {
    const first = await Promise.all([page.waitForEvent('download'), trigger.click()]).then(
      ([d]) => d,
    );
    // The save loop fires per-file downloads synchronously inside one
    // microtask; pause briefly for any siblings to land before unhooking.
    await page.waitForTimeout(200);
    // `first` already passed through the listener, so just return as-is.
    void first;
    return downloads.slice();
  } finally {
    page.off('download', off);
  }
}

/**
 * Look up the golden text inside `e2e/fixtures/expected/`. Throws with a
 * clear message when the file is missing so the test points at the
 * regeneration script (`e2e/scripts/build-expected.mjs`).
 */
export async function readExpected(relativePath: string): Promise<string> {
  const filePath = path.join(FIXTURES_ROOT, 'expected', relativePath);
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `expected golden "${relativePath}" missing at ${filePath} — ` +
        `regenerate via \`node e2e/scripts/build-expected.mjs\`. ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}
