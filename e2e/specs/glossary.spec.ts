/**
 * Group E — Glossary.
 *
 * E1: Adding a glossary term and triggering a translation lands a
 *     `glossary_id` on the DeepL /v2/translate request. The mock declares
 *     EN→PL as a supported glossary pair, answers `/v2/glossaries` with
 *     a fake id, and the spec inspects the recorded request payload.
 *
 * E2: Glossary entries survive a reload through the FS Access reopen
 *     path. Gated behind `supportsFs` for the same reason A3 is —
 *     `showDirectoryPicker` is Chromium-only and the test seeds a stub
 *     directory handle into IDB so the auto-reopen path runs end-to-end.
 *
 * Both scenarios install `mockProviders(page, { glossary: true })` so
 * the DeepL glossary endpoints answer with realistic JSON.
 */

import { expect, test, type Page } from '@playwright/test';

import { mockProviders, type MockProvidersHandle } from '../mocks/ai.js';
import { ApiKeyPrompt } from '../pages/ApiKeyPrompt.js';
import { EditorPage } from '../pages/EditorPage.js';
import { GlossaryModal } from '../pages/GlossaryModal.js';
import { PassphrasePrompt } from '../pages/PassphrasePrompt.js';
import { resetAppState } from '../utils/idb.js';
import { TEST_PASSPHRASE } from '../utils/passphrase.js';

test.describe('E. Glossary', () => {
  let handle: MockProvidersHandle;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetAppState(page);
    await page.goto('/');
    handle = await mockProviders(page, { deepl: true, glossary: true });
  });

  test('E1 — glossary flows into the DeepL /v2/translate request', async ({ page }) => {
    const editor = new EditorPage(page);
    const glossary = new GlossaryModal(page);
    const passphrase = new PassphrasePrompt(page);
    const apiKey = new ApiKeyPrompt(page);
    await editor.openFiles('with-missing');

    // Open the glossary modal, add a single term and pin a target-locale
    // translation for it. The reducer commits on blur (we press Enter
    // inside the POM helpers to trigger the blur path).
    await editor.glossaryButton.click();
    await expect(glossary.root).toBeVisible();
    await glossary.addTerm('Polylocale');
    await glossary.setTranslation('Polylocale', 'pl', 'Polylokal');
    expect(await glossary.list()).toContain('Polylocale');
    await glossary.close();

    // Trigger a translation that goes through DeepL. The first click
    // fires the unlock + api-key prompts; subsequent clicks reuse the
    // adapter instance the host caches.
    await editor.cellSuggestButton('home', 'pl').click();
    await passphrase.unlock(TEST_PASSPHRASE);
    await apiKey.submit('deepl-test-key:fx');

    const popover = editor.suggestionPopover;
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: 'Accept' }).click();

    // The /v2/translate payload must carry the glossary_id our mock
    // returned from the create flow. `mockProviders` records every
    // intercepted request; `lastTranslate` is the most recent translate
    // call across providers.
    await expect
      .poll(() => {
        const last = handle.lastTranslate();
        if (last === undefined) return undefined;
        const body = last.body as { glossary_id?: unknown } | null;
        return body?.glossary_id;
      })
      .toBe('mock-glossary-id');

    // And the mock /v2/glossaries POST happened (the create flow ran).
    const deeplCalls = handle.deepl();
    const createCalls = deeplCalls.filter(
      (r) => r.method === 'POST' && /\/v2\/glossaries(\?|$)/.test(r.url),
    );
    expect(createCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('E2 — glossary entries survive a reload (FS Access reopen)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'showDirectoryPicker is Chromium-only');
    const editor = new EditorPage(page);
    const supportsFs = await editor.supportsFsAccess();
    test.skip(!supportsFs, 'browser does not implement showDirectoryPicker');

    // Install the same FS Access stub A3 uses: a stub directory handle
    // is restored on every read of `directory-handles:last`, so the
    // SPA's auto-reopen path runs end-to-end after a reload.
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
      '  }\n' +
      '}\n';

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
            name: 'glossary-stub',
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

    // Seed IDB placeholders for both stores so the SPA's load path finds
    // something on each. We let the SPA write the meta record itself
    // when the glossary entry is added, since the editor's persistence
    // effect fires on glossary changes.
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
              projectName: 'glossary-stub',
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

    // Trigger the auto-reopen by reloading. The init script restores
    // the stub on every IDB read, so the SPA gets a usable handle.
    await page.reload();
    await expect(editor.cell('appTitle', 'en')).toBeVisible({ timeout: 10_000 });

    // Add two glossary entries — the editor's `useEffect` persists them
    // to `editor-meta.glossary` whenever the project's glossary changes
    // and the SPA is in fs-access mode.
    const glossary = new GlossaryModal(page);
    await editor.glossaryButton.click();
    await glossary.addTerm('Polylocale');
    await glossary.setTranslation('Polylocale', 'pl', 'Polylokal');
    await glossary.addTerm('Brand');
    await glossary.setTranslation('Brand', 'pl', 'Marka');

    // Wait until the persistence effect has flushed both entries.
    await expect.poll(async () => readEditorMetaGlossarySize(page)).toBeGreaterThanOrEqual(2);
    await glossary.close();

    // Reload — the auto-reopen path restores the project and the
    // glossary should be re-attached through `EditorMeta.glossary`.
    await page.reload();
    await expect(editor.cell('appTitle', 'en')).toBeVisible({ timeout: 10_000 });
    await editor.glossaryButton.click();
    await expect(glossary.root).toBeVisible();
    const listed = await glossary.list();
    expect(listed).toContain('Polylocale');
    expect(listed).toContain('Brand');
  });
});

/**
 * Read `editor-meta.last.glossary?.length` from the SPA's IndexedDB so
 * the test can poll the persistence flush rather than racing it.
 */
async function readEditorMetaGlossarySize(page: Page): Promise<number> {
  return page.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open('polylocale-editor', 1);
      req.onsuccess = (): void => {
        const db = req.result;
        const tx = db.transaction('editor-meta', 'readonly');
        const get = tx.objectStore('editor-meta').get('last');
        get.onsuccess = (): void => {
          const value = get.result as { glossary?: readonly unknown[] } | undefined;
          resolve(Array.isArray(value?.glossary) ? value.glossary.length : 0);
          db.close();
        };
        get.onerror = (): void => {
          resolve(0);
          db.close();
        };
      };
      req.onerror = (): void => resolve(0);
    });
  });
}
