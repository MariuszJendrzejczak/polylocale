import type { CSSProperties } from 'react';

import { StatusBadge } from '@polylocale/ui';

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'center',
  padding: 20,
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

// The full status vocabulary used across the localization editor: one badge per
// key/value condition. This is the primary variant axis.
export function Variants() {
  return (
    <div style={row}>
      <StatusBadge variant="ok" />
      <StatusBadge variant="missing" />
      <StatusBadge variant="needs-review" />
      <StatusBadge variant="placeholder-mismatch" />
      <StatusBadge variant="empty" />
      <StatusBadge variant="modified" />
    </div>
  );
}

// `children` overrides the default label — used to surface counts or context
// next to a status (e.g. how many keys are affected).
export function CustomLabels() {
  return (
    <div style={row}>
      <StatusBadge variant="missing">4 missing</StatusBadge>
      <StatusBadge variant="needs-review">12 to review</StatusBadge>
      <StatusBadge variant="placeholder-mismatch">{'{count} vs {n}'}</StatusBadge>
      <StatusBadge variant="modified" title="Unsaved changes">
        edited
      </StatusBadge>
    </div>
  );
}
