import type { ReactElement } from 'react';

import styles from './StatusBadge.module.css';

export type StatusBadgeVariant =
  | 'ok'
  | 'missing'
  | 'needs-review'
  | 'placeholder-mismatch'
  | 'empty'
  | 'modified';

export interface StatusBadgeProps {
  readonly variant: StatusBadgeVariant;
  readonly title?: string;
  readonly children?: string;
}

const LABEL: Readonly<Record<StatusBadgeVariant, string>> = {
  ok: 'OK',
  missing: 'missing',
  'needs-review': 'review',
  'placeholder-mismatch': 'placeholders',
  empty: 'empty',
  modified: 'modified',
};

export function StatusBadge(props: StatusBadgeProps): ReactElement {
  const { variant, title, children } = props;
  return (
    <span
      className={`${styles.badge} ${styles[variantClass(variant)]}`}
      title={title ?? LABEL[variant]}
    >
      {children ?? LABEL[variant]}
    </span>
  );
}

function variantClass(variant: StatusBadgeVariant): string {
  return variant.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}
