import { useEffect, useRef, useState, type ReactElement } from 'react';

import styles from './RowTranslateMenu.module.css';

export interface RowTranslateMenuProps {
  readonly disabled?: boolean;
  readonly onTranslateMissing: () => void;
}

export function RowTranslateMenu(props: RowTranslateMenuProps): ReactElement {
  const { disabled = false, onTranslateMissing } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

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

  return (
    <span ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.button}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label="Row actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        ⋯
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            className={styles.menuItem}
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onTranslateMissing();
            }}
          >
            Translate missing locales
          </button>
        </div>
      )}
    </span>
  );
}
