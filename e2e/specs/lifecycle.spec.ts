/**
 * Group A — Project lifecycle.
 *
 * A1: Open files (fallback) and render table.
 * A2: Edit cell → save → exported file matches expected golden.
 * A3: FS Access reopen after reload (Chromium-only via supportsFs probe).
 */

import { expect, test } from '@playwright/test';

import { EditorPage } from '../pages/EditorPage.js';
import { resetAppState } from '../utils/idb.js';
import { clickAndCaptureDownloads, readDownload, readExpected } from '../utils/file-system.js';

test.describe('A. Project lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetAppState(page);
    await page.goto('/');
  });

  test('A1 — fallback open renders the table with the right rows', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.openFiles('basic-arb');

    // Five keys from the basic fixture: appTitle, greeting, home, homeSubtitle, save.
    // Each renders one cell per locale; the en column always has a value.
    for (const key of ['appTitle', 'greeting', 'home', 'homeSubtitle', 'save']) {
      await expect(editor.cell(key, 'en')).toBeVisible();
      await expect(editor.cell(key, 'pl')).toBeVisible();
    }

    // Base locale auto-selected from the first parsed file (en.arb alphabetically).
    await expect.poll(() => editor.currentBaseLocale()).toBe('en');
  });

  // Fixme: deterministic CI-only timeout — see issue #9.
  test.fixme('A2 — edit cell, save, downloaded blob matches golden', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.openFiles('basic-arb');

    await editor.editCell('save', 'pl', 'Zapisz!');

    // The cell renders the edited value back.
    await expect(editor.cell('save', 'pl')).toContainText('Zapisz!');

    const downloads = await clickAndCaptureDownloads(page, editor.saveButton);
    const byName = new Map<string, string>();
    for (const dl of downloads) {
      const { text } = await readDownload(dl);
      byName.set(dl.suggestedFilename(), text);
    }
    expect(byName.has('pl.arb')).toBeTruthy();
    expect(byName.has('en.arb')).toBeTruthy();

    const expectedPl = await readExpected('A2.pl.arb');
    const expectedEn = await readExpected('A2.en.arb');
    expect(byName.get('pl.arb')).toBe(expectedPl);
    expect(byName.get('en.arb')).toBe(expectedEn);
  });

  test('A3 — FS Access reopen after reload (Chromium-only)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'showDirectoryPicker is Chromium-only');
    const editor = new EditorPage(page);
    const supportsFs = await editor.supportsFsAccess();
    test.skip(!supportsFs, 'browser does not implement showDirectoryPicker');

    // Driving the real OS directory picker from Playwright is not
    // supported — the API is gated on a transient user activation and the
    // picker is a chrome dialog. We seed the editor IDB with a stub
    // directory handle that mimics the parts the SPA touches:
    //   - `queryPermission` / `requestPermission` for the perm gate,
    //   - `values()` yielding synthetic file handles whose `getFile()`
    //     returns the inline ARB content.
    // Once we've written the stub, install a navigator-side patch so the
    // stub is restored to its prototype after the structured-clone
    // round-trip strips its methods (IDB only serialises data, not
    // function members). The reload then triggers the SPA's auto-reopen
    // path end-to-end.
    const EN_ARB =
      '{\n' +
      '  "@@locale": "en",\n' +
      '  "appTitle": "Polylocale",\n' +
      '  "greeting": "Hello {name}",\n' +
      '  "@greeting": {\n' +
      '    "placeholders": { "name": { "type": "String" } }\n' +
      '  },\n' +
      '  "save": "Save"\n' +
      '}\n';
    const PL_ARB =
      '{\n' +
      '  "@@locale": "pl",\n' +
      '  "appTitle": "Polylocale",\n' +
      '  "greeting": "Witaj {name}",\n' +
      '  "@greeting": {\n' +
      '    "placeholders": { "name": { "type": "String" } }\n' +
      '  },\n' +
      '  "save": "Zapisz"\n' +
      '}\n';

    // 1. Install the directory-handle stub at init time — `addInitScript`
    // runs before any document scripts on every navigation. We monkey-
    // patch the polylocale-editor connection so the handle returned from
    // IDB always has live `queryPermission`/`values` methods, regardless
    // of structured-clone fidelity in the underlying browser.
    await page.addInitScript(
      ({ enArb, plArb }: { enArb: string; plArb: string }): void => {
        type DirHandleStub = {
          kind: 'directory';
          name: string;
          queryPermission: () => Promise<PermissionState>;
          requestPermission: () => Promise<PermissionState>;
          values: () => AsyncGenerator<unknown>;
        };

        function makeStub(): DirHandleStub {
          function fileHandle(name: string, text: string): unknown {
            return {
              kind: 'file',
              name,
              async getFile(): Promise<File> {
                return new File([text], name, { type: 'application/json' });
              },
            };
          }
          return {
            kind: 'directory',
            name: 'basic-arb-stub',
            async queryPermission(): Promise<PermissionState> {
              return 'granted';
            },
            async requestPermission(): Promise<PermissionState> {
              return 'granted';
            },
            async *values(): AsyncGenerator<unknown> {
              yield fileHandle('en.arb', enArb);
              yield fileHandle('pl.arb', plArb);
            },
          };
        }

        // Intercept reads to the directory-handles store and substitute
        // the stub. We can't structured-clone our methods through IDB,
        // so we don't try — every read of `last` resolves to a fresh
        // stub object whose closures keep the file content alive.
        const origOpen = indexedDB.open.bind(indexedDB);
        indexedDB.open = function (name: string, version?: number): IDBOpenDBRequest {
          const req = origOpen(name, version);
          if (name !== 'polylocale-editor') return req;
          req.addEventListener('success', () => {
            const db = req.result;
            const origTx = db.transaction.bind(db);
            (db as unknown as { transaction: typeof origTx }).transaction = function (
              stores: string | Iterable<string>,
              mode?: IDBTransactionMode,
            ): IDBTransaction {
              const tx = origTx(stores, mode);
              const origObjectStore = tx.objectStore.bind(tx);
              (tx as unknown as { objectStore: typeof origObjectStore }).objectStore = function (
                storeName: string,
              ): IDBObjectStore {
                const store = origObjectStore(storeName);
                if (storeName !== 'directory-handles') return store;
                const origGet = store.get.bind(store);
                (store as unknown as { get: typeof origGet }).get = function (
                  key: IDBValidKey,
                ): IDBRequest {
                  const r = origGet(key);
                  r.addEventListener('success', () => {
                    if (r.result !== undefined && key === 'last') {
                      Object.defineProperty(r, 'result', {
                        value: makeStub(),
                        configurable: true,
                      });
                    }
                  });
                  return r;
                };
                return store;
              };
              return tx;
            };
          });
          return req;
        };
      },
      { enArb: EN_ARB, plArb: PL_ARB },
    );

    // 2. Seed IDB with a placeholder so the SPA's `loadDirectoryHandle`
    // finds *something* to read; the init-script interceptor will swap
    // the cloned value for a live stub when the SPA actually reads it.
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('polylocale-editor', 1);
        req.onupgradeneeded = (): void => {
          const db = req.result;
          if (!db.objectStoreNames.contains('directory-handles')) {
            db.createObjectStore('directory-handles');
          }
          if (!db.objectStoreNames.contains('editor-meta')) {
            db.createObjectStore('editor-meta');
          }
        };
        req.onsuccess = (): void => {
          const db = req.result;
          const tx = db.transaction(['directory-handles', 'editor-meta'], 'readwrite');
          tx.objectStore('directory-handles').put({ placeholder: true }, 'last');
          tx.objectStore('editor-meta').put(
            {
              projectName: 'basic-arb-stub',
              baseLocale: 'en',
              lastOpenedAt: Date.now(),
            },
            'last',
          );
          tx.oncomplete = (): void => {
            db.close();
            resolve();
          };
          tx.onerror = (): void => reject(tx.error);
        };
        req.onerror = (): void => reject(req.error);
      });
    });

    await page.reload();

    // Auto-reopen kicked in: the table renders the stubbed project.
    await expect(editor.cell('appTitle', 'en')).toBeVisible({ timeout: 10_000 });
    await expect(editor.cell('greeting', 'pl')).toBeVisible();
    expect(await editor.currentBaseLocale()).toBe('en');
  });
});
