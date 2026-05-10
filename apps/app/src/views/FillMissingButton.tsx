import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { LocaleCode } from '@polylocale/core';

import styles from './FillMissingButton.module.css';

export interface FillMissingButtonProps {
  readonly locales: readonly LocaleCode[];
  readonly disabled?: boolean;
  readonly onFill: (locale: LocaleCode) => void;
}

export function FillMissingButton(props: FillMissingButtonProps): ReactElement | null {
  const { locales, disabled = false, onFill } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (!(e.target instanceof Node)) return;
      if (rootRef.current?.contains(e.target) === true) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (locales.length === 0) return null;

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.button}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Fill missing for…
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {locales.map((locale) => (
            <button
              key={locale}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onFill(locale);
              }}
            >
              {locale}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
