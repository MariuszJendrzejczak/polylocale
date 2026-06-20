import type { CSSProperties } from 'react';

import { StatusBadge, Table, type TableColumn } from '@polylocale/ui';

// A localization key with its base (English) and a target (Polish) translation,
// plus a derived status — the shape the editor renders one row per.
interface Entry {
  readonly id: string;
  readonly key: string;
  readonly en: string;
  readonly pl: string | null;
  readonly status: 'ok' | 'missing' | 'needs-review' | 'placeholder-mismatch';
}

const entries: readonly Entry[] = [
  { id: '1', key: 'app.title', en: 'Polylocale', pl: 'Polylocale', status: 'ok' },
  { id: '2', key: 'editor.toolbar.save', en: 'Save', pl: 'Zapisz', status: 'ok' },
  { id: '3', key: 'editor.cell.untranslated', en: 'Translate this value', pl: null, status: 'missing' },
  {
    id: '4',
    key: 'inbox.count',
    en: '{count, plural, one {# message} other {# messages}}',
    pl: '{count, plural, one {# wiadomość} other {# wiadomości}}',
    status: 'needs-review',
  },
  {
    id: '5',
    key: 'greeting.hello',
    en: 'Hello, {name}!',
    pl: 'Cześć, {imie}!',
    status: 'placeholder-mismatch',
  },
  { id: '6', key: 'nav.settings', en: 'Settings', pl: 'Ustawienia', status: 'ok' },
  { id: '7', key: 'errors.network', en: 'Network error', pl: 'Błąd sieci', status: 'ok' },
  { id: '8', key: 'export.format.arb', en: 'ARB (Flutter)', pl: 'ARB (Flutter)', status: 'ok' },
];

const mono: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  color: '#424248',
};
const value: CSSProperties = { fontSize: 13, color: '#1b1b1f', overflow: 'hidden', textOverflow: 'ellipsis' };

const columns: readonly TableColumn<Entry>[] = [
  {
    id: 'key',
    header: 'Key',
    width: 240,
    sortBy: (row) => row.key,
    cell: (row) => <span style={mono}>{row.key}</span>,
  },
  {
    id: 'en',
    header: 'English (base)',
    minWidth: 240,
    sortBy: (row) => row.en,
    cell: (row) => <span style={value}>{row.en}</span>,
  },
  {
    id: 'pl',
    header: 'Polish',
    minWidth: 240,
    cell: (row) => (row.pl === null ? <StatusBadge variant="missing" /> : <span style={value}>{row.pl}</span>),
  },
  {
    id: 'status',
    header: 'Status',
    width: 150,
    cell: (row) => <StatusBadge variant={row.status} />,
  },
];

const frame: CSSProperties = {
  height: 320,
  width: 880,
  border: '1px solid #e3e3e6',
  borderRadius: 8,
  overflow: 'hidden',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

// The editor's main surface: a virtualized, sortable grid of localization keys
// with their translations and per-cell status badges.
export function LocalizationGrid() {
  return (
    <div style={frame}>
      <Table<Entry> rows={entries} columns={columns} rowKey={(row) => row.id} />
    </div>
  );
}

// The empty state, shown via the `emptyState` prop when there are no rows.
export function EmptyState() {
  return (
    <div style={frame}>
      <Table<Entry>
        rows={[]}
        columns={columns}
        rowKey={(row) => row.id}
        emptyState={<span style={{ color: '#6b6b73' }}>No keys match the current filter.</span>}
      />
    </div>
  );
}
