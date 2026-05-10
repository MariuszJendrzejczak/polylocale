import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { renderICU, type ICUNode, type LocaleCode } from '@polylocale/core';

import type { TranslationOutcome } from '../services/translate-orchestrator.js';

import styles from './BatchTranslateModal.module.css';

export interface AcceptedTranslation {
  readonly keyId: string;
  readonly keyPath: string;
  readonly locale: LocaleCode;
  readonly ir: readonly ICUNode[];
  readonly raw: string;
}

export interface BatchTranslateModalProps {
  readonly title: string;
  readonly outcomes: readonly TranslationOutcome[];
  readonly baseTextFor: (keyId: string) => string;
  readonly onApply: (accepted: readonly AcceptedTranslation[]) => void;
  readonly onClose: () => void;
}

export function BatchTranslateModal(props: BatchTranslateModalProps): ReactElement {
  const { title, outcomes, baseTextFor, onApply, onClose } = props;
  const readyKeys = useMemo(() => {
    const out = new Set<string>();
    for (const o of outcomes) {
      if (o.status.kind === 'ready') out.add(rowKey(o));
    }
    return out;
  }, [outcomes]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(readyKeys);

  useEffect(() => {
    setSelected(readyKeys);
  }, [readyKeys]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggle(k: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function applySelected(): void {
    const accepted: AcceptedTranslation[] = [];
    for (const o of outcomes) {
      if (o.status.kind !== 'ready') continue;
      if (!selected.has(rowKey(o))) continue;
      const raw = renderICU(o.status.ir);
      accepted.push({
        keyId: o.job.keyId,
        keyPath: o.job.keyPath,
        locale: o.job.locale,
        ir: o.status.ir,
        raw,
      });
    }
    onApply(accepted);
  }

  const counts = countOutcomes(outcomes);
  const acceptCount = selected.size;

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-title"
      >
        <header className={styles.header}>
          <h2 id="batch-title" className={styles.title}>
            {title}
          </h2>
          <span className={styles.summary}>
            {counts.ready} ready · {counts.skipped} skipped · {counts.errored} failed
          </span>
        </header>
        <div className={styles.list}>
          {outcomes.length === 0 && (
            <div className={styles.empty}>Nothing to translate — every cell already has a value.</div>
          )}
          {outcomes.map((outcome) => {
            const k = rowKey(outcome);
            const ready = outcome.status.kind === 'ready';
            const checked = selected.has(k);
            const beforeText = baseTextFor(outcome.job.keyId);
            const afterText =
              outcome.status.kind === 'ready' ? renderICU(outcome.status.ir) : '';
            const reason = describeStatus(outcome);
            return (
              <div
                key={k}
                className={`${styles.row} ${ready ? '' : styles.rowSkipped}`}
              >
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={ready && checked}
                  disabled={!ready}
                  onChange={() => ready && toggle(k)}
                  aria-label={`Apply ${outcome.job.keyPath} ${outcome.job.locale}`}
                />
                <div className={styles.meta}>
                  <div className={styles.keyPath}>
                    <span className={styles.locale}>{outcome.job.locale}</span>
                    <span>{outcome.job.keyPath}</span>
                  </div>
                  {reason !== null && <div className={styles.reason}>{reason}</div>}
                </div>
                <div className={styles.before}>{beforeText}</div>
                <div className={styles.after}>{ready ? afterText : ''}</div>
              </div>
            );
          })}
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={applySelected}
            disabled={acceptCount === 0}
          >
            Apply {acceptCount} selected
          </button>
        </footer>
      </div>
    </div>
  );
}

function rowKey(outcome: TranslationOutcome): string {
  return `${outcome.job.keyId}:${outcome.job.locale}`;
}

interface OutcomeCounts {
  readonly ready: number;
  readonly skipped: number;
  readonly errored: number;
}

function countOutcomes(outcomes: readonly TranslationOutcome[]): OutcomeCounts {
  let ready = 0;
  let skipped = 0;
  let errored = 0;
  for (const o of outcomes) {
    switch (o.status.kind) {
      case 'ready':
        ready++;
        break;
      case 'skipped-empty':
      case 'skipped-unsupported':
        skipped++;
        break;
      case 'error':
        errored++;
        break;
    }
  }
  return { ready, skipped, errored };
}

function describeStatus(outcome: TranslationOutcome): string | null {
  switch (outcome.status.kind) {
    case 'ready':
      return null;
    case 'skipped-empty':
      return 'skipped: nothing to translate';
    case 'skipped-unsupported':
      return `skipped: ${outcome.status.message}`;
    case 'error':
      return `failed: ${outcome.status.message}`;
  }
}
