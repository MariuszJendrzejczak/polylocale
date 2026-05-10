import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { renderICU, type ICUNode, type LocaleCode, type TranslationValue } from '@polylocale/core';
import { collectTextNodes, UnsupportedLocaleError } from '@polylocale/ai';

import type { AIProviderHost } from '../services/ai-provider-host.js';

import styles from './AiCellAction.module.css';

export interface AiCellActionProps {
  readonly host: AIProviderHost;
  readonly keyId: string;
  readonly keyPath: string;
  readonly locale: LocaleCode;
  readonly baseLocale: LocaleCode;
  readonly baseValue: TranslationValue | undefined;
  readonly description?: string;
  readonly isPending: boolean;
  readonly onStart: () => void;
  readonly onClear: () => void;
  readonly onFail: (message: string) => void;
  readonly onAccept: (ir: readonly ICUNode[], raw: string) => void;
}

interface PopoverState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly suggestion?: { readonly ir: readonly ICUNode[]; readonly raw: string };
  readonly errorMessage?: string;
}

export function AiCellAction(props: AiCellActionProps): ReactElement | null {
  const {
    host,
    keyPath,
    locale,
    baseLocale,
    baseValue,
    description,
    isPending,
    onStart,
    onClear,
    onFail,
    onAccept,
  } = props;
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const closeRef = useRef<() => void>(() => {});

  const close = useCallback((clear: boolean): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPopover(null);
    if (clear) onClear();
  }, [onClear]);

  closeRef.current = () => close(true);

  // Click-outside / Escape — only when popover is open.
  useEffect(() => {
    if (popover === null) return;
    function onDocClick(e: MouseEvent): void {
      const target = e.target as Node | null;
      if (target === null) return;
      if (!(target instanceof Element)) return;
      if (target.closest(`.${styles.popover}`) !== null) return;
      if (target.closest(`.${styles.button}`) !== null) return;
      closeRef.current();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  if (baseValue === undefined) return null;
  const baseFragmentCount = collectTextNodes(baseValue.ir).texts.length;
  if (baseFragmentCount === 0) return null;

  async function onClick(): Promise<void> {
    if (isPending || popover !== null) return;

    const provider = await host.getProvider();
    if (provider === null) return; // user cancelled a gate; no banner

    onStart();
    setPopover({ status: 'loading' });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const translatedNodes = await provider.translate({
        nodes: baseValue!.ir,
        from: baseLocale,
        to: locale,
        ...(description !== undefined ? { context: { keyPath, description } } : { context: { keyPath } }),
      });
      if (controller.signal.aborted) return;
      const raw = renderICU(translatedNodes);
      setPopover({ status: 'ready', suggestion: { ir: translatedNodes, raw } });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof UnsupportedLocaleError) {
        setPopover({ status: 'error', errorMessage: message });
      } else {
        setPopover(null);
        onFail(message);
      }
    }
  }

  function accept(): void {
    if (popover?.status !== 'ready' || popover.suggestion === undefined) return;
    abortRef.current = null;
    setPopover(null);
    onAccept(popover.suggestion.ir, popover.suggestion.raw);
  }

  return (
    <span className={styles.root}>
      <button
        type="button"
        className={styles.button}
        onClick={(e) => {
          e.stopPropagation();
          void onClick();
        }}
        title={`Translate from ${baseLocale}`}
        aria-label={`Translate ${keyPath} into ${locale}`}
        disabled={isPending}
      >
        ✦
      </button>
      {popover !== null && (
        <div
          className={styles.popover}
          role="dialog"
          aria-label="Translation suggestion"
          onClick={(e) => e.stopPropagation()}
        >
          {popover.status === 'loading' && (
            <div className={styles.row}>
              <span className={styles.spinner} aria-hidden="true" />
              <span className={styles.muted}>Translating…</span>
            </div>
          )}
          {popover.status === 'ready' && popover.suggestion !== undefined && (
            <>
              <div className={styles.section}>
                <div className={styles.label}>{baseLocale}</div>
                <div className={styles.before}>{renderICU(baseValue!.ir)}</div>
              </div>
              <div className={styles.section}>
                <div className={styles.label}>{locale}</div>
                <div className={styles.after}>{popover.suggestion.raw}</div>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    close(true);
                  }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.primary}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    accept();
                  }}
                >
                  Accept
                </button>
              </div>
            </>
          )}
          {popover.status === 'error' && (
            <>
              <div className={styles.errorMsg}>{popover.errorMessage ?? 'Translation failed'}</div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    close(true);
                  }}
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
