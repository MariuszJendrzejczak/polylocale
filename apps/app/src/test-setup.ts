import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';

afterEach((): void => {
  cleanup();
});

if (typeof globalThis.indexedDB === 'undefined') {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: new IDBFactory(),
  });
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  // The virtualizer relies on ResizeObserver firing at least once with the
  // initial size; a no-op mock leaves it permanently empty in jsdom.
  globalThis.ResizeObserver = class FakeResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      queueMicrotask((): void => {
        const rect = target.getBoundingClientRect();
        const entry = {
          target,
          contentRect: rect,
          borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          devicePixelContentBoxSize: [
            { inlineSize: rect.width, blockSize: rect.height },
          ],
        } as unknown as ResizeObserverEntry;
        this.callback([entry], this as unknown as ResizeObserver);
      });
    }
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom returns 0 for layout queries; @tanstack/react-virtual then renders no
// rows, which would defeat any test that asserts on table contents. Force a
// non-zero viewport so virtualization sees a window large enough for fixtures.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get(): number {
    return 600;
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get(): number {
    return 800;
  },
});
Element.prototype.getBoundingClientRect = function (): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    toJSON: (): unknown => ({}),
  };
};
